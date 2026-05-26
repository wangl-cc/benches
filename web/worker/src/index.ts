import {
  type BenchRun,
  type JsonObject,
  canonicalJson,
  parseBenchRunJson,
} from "../../packages/bench-schema/src/index.ts";
import { isAuthorized, parseUploadTokens } from "./auth.ts";
import { addFilter, corsHeaders, json, readLimit, readOffset } from "./http.ts";
import { compressRawRun, decompressRawRun } from "./raw-json.ts";
import {
  findRawRun,
  findRun,
  insertRun,
  listRunRows,
  resultRow,
  resultRows,
  runMetadata,
} from "./repository.ts";
import { deriveSummaries, isQuickRun, rawCaseCount } from "./summaries.ts";
import type { Env, IngestPolicy } from "./types.ts";

export { parseUploadTokens } from "./auth.ts";
export { compressRawRun, decompressRawRun } from "./raw-json.ts";
export { deriveSummaries } from "./summaries.ts";

const MAX_POST_BYTES = 10 * 1024 * 1024;
const MAX_D1_BLOB_BYTES = 1_800_000;
const MAX_MEASUREMENTS_PER_RUN = 5_000;
const MAX_SUMMARIES_PER_RUN = 5_000;
const MAX_CASES_PER_RUN = 5_000;

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(JSON.stringify({ error: String(error) }));
      return json({ error: "internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method === "POST" && path === "/api/runs") {
    return postRun(request, env);
  }
  if (request.method === "GET" && path === "/api/runs") {
    return listRuns(env, url);
  }
  if (request.method === "GET" && path.startsWith("/api/runs/")) {
    return getRun(env, decodeURIComponent(path.slice("/api/runs/".length)));
  }
  if (request.method === "GET" && path === "/api/results") {
    return getResults(env, url);
  }

  return json({ error: "not found" }, 404);
}

async function postRun(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorized(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

  const contentLengthError = validateContentLength(request);
  if (contentLengthError) {
    return contentLengthError;
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return json({ error: "invalid JSON" }, 422);
  }
  if (new TextEncoder().encode(body).byteLength > MAX_POST_BYTES) {
    return json({ error: "request body is too large" }, 413);
  }

  const validation = parseBenchRunJson(body);
  if (!validation.ok) {
    return json({ error: "invalid schema", issues: validation.issues }, 422);
  }

  const run = validation.value;
  const policyIssues = validateIngestPolicy(run, ingestPolicy(request, env));
  if (policyIssues.length > 0) {
    return json({ error: "ingest policy rejected run", issues: policyIssues }, 422);
  }

  const derived = deriveSummaries(run);
  if (!derived.ok) {
    return json({ error: "invalid measurements", issues: derived.issues }, 422);
  }

  const admissionIssues = validateIngestLimits(run, derived.summaries);
  if (admissionIssues.length > 0) {
    return json({ error: "run exceeds ingest limits", issues: admissionIssues }, 422);
  }

  const contentHash = await hashRun(run);
  const suppliedHash = request.headers.get("x-bench-content-sha256");
  if (suppliedHash && suppliedHash !== contentHash) {
    return json(
      { error: "content hash mismatch", expected: contentHash, received: suppliedHash },
      400,
    );
  }

  const existing = await findRun(env, run.runId);
  if (existing) {
    if (existing.content_hash !== contentHash) {
      return json({ error: "runId already exists with different content" }, 409);
    }
    return json(runMetadata(existing, true), 200);
  }

  const rawRun = await compressRawRun(body);
  if (rawRun.compressedBytes > MAX_D1_BLOB_BYTES) {
    return json(
      {
        error: "compressed raw run is too large",
        compressedBytes: rawRun.compressedBytes,
        maxBytes: MAX_D1_BLOB_BYTES,
      },
      413,
    );
  }

  try {
    await insertRun(env, run, contentHash, rawRun, derived.summaries);
  } catch (error) {
    const concurrent = await findRun(env, run.runId);
    if (concurrent?.content_hash === contentHash) {
      return json(runMetadata(concurrent, true), 200);
    }
    if (concurrent) {
      return json({ error: "runId already exists with different content" }, 409);
    }
    throw error;
  }

  const inserted = await findRun(env, run.runId);
  if (!inserted) {
    throw new Error("inserted run could not be loaded");
  }
  return json(runMetadata(inserted, false), 201);
}

function validateContentLength(request: Request): Response | null {
  const contentLength = request.headers.get("content-length");
  const expectedBytes = contentLength === null ? undefined : Number(contentLength);
  if (
    expectedBytes !== undefined &&
    (!Number.isInteger(expectedBytes) || expectedBytes < 0)
  ) {
    return json({ error: "invalid content-length" }, 400);
  }
  if (expectedBytes !== undefined && expectedBytes > MAX_POST_BYTES) {
    return json({ error: "request body is too large" }, 413);
  }
  return null;
}

function ingestPolicy(request: Request, env: Env): IngestPolicy {
  return {
    allowQuickRuns:
      env.ALLOW_QUICK_RUNS === "true" ||
      isLocalTestHost(new URL(request.url).hostname),
  };
}

export function validateIngestPolicy(
  run: BenchRun,
  policy: IngestPolicy,
): string[] {
  if (!policy.allowQuickRuns && isQuickRun(run)) {
    return ["quick benchmark runs are accepted only by local or explicitly configured test backends"];
  }
  return [];
}

export function validateIngestLimits(
  run: BenchRun,
  summaries: readonly JsonObject[],
): string[] {
  const issues: string[] = [];
  if (run.measurements.length > MAX_MEASUREMENTS_PER_RUN) {
    issues.push(`measurements exceed limit ${MAX_MEASUREMENTS_PER_RUN}`);
  }
  if (summaries.length > MAX_SUMMARIES_PER_RUN) {
    issues.push(`summaries exceed limit ${MAX_SUMMARIES_PER_RUN}`);
  }
  if (rawCaseCount(run) > MAX_CASES_PER_RUN) {
    issues.push(`cases exceed limit ${MAX_CASES_PER_RUN}`);
  }
  return issues;
}

function isLocalTestHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

async function listRuns(env: Env, url: URL): Promise<Response> {
  const runs = await listRunRows(env, readLimit(url, 50, 200), readOffset(url));
  return json({ runs: runs.map((row) => runMetadata(row, false)) });
}

async function getRun(env: Env, runId: string): Promise<Response> {
  const row = await findRun(env, runId);
  if (!row) {
    return json({ error: "not found" }, 404);
  }

  const rawRun = await findRawRun(env, runId);
  if (!rawRun) {
    return json({ error: "raw run is missing" }, 500);
  }
  if (rawRun.raw_json_encoding !== "gzip") {
    return json({ error: "unsupported raw run encoding" }, 500);
  }

  const headers = new Headers();
  headers.set("etag", `"${row.content_hash}"`);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "public, max-age=300");
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(await decompressRawRun(rawRun.raw_json_gzip), { headers });
}

async function getResults(env: Env, url: URL): Promise<Response> {
  const filters: string[] = [];
  const values: unknown[] = [];

  addFilter(filters, values, "rs.benchmark_name", url.searchParams.get("benchmark"));
  addFilter(filters, values, "rs.case_id", url.searchParams.get("case"));
  addFilter(filters, values, "rs.metric", url.searchParams.get("metric"));
  addFilter(filters, values, "runs.run_id", url.searchParams.get("runId"));
  addFilter(filters, values, "runs.host_id", url.searchParams.get("host"));

  values.push(readLimit(url, 200, 1000));
  values.push(readOffset(url));

  const rows = await resultRows(env, filters, values);
  return json({ results: rows.map(resultRow) });
}

export async function hashRun(run: BenchRun): Promise<string> {
  return hex(await sha256(canonicalJson(run)));
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
