import {
  type BenchRun,
  type JsonValue,
  type JsonObject,
  canonicalJson,
  isObject,
  numberField,
  parseBenchRunJson,
  stringField,
} from "../../packages/bench-schema/src/index.ts";

type Env = {
  readonly BENCH_DB: D1Database;
  readonly BENCH_RAW_RUNS: R2Bucket;
  readonly CF_ACCESS_CLIENT_ID?: string;
  readonly CF_ACCESS_CLIENT_SECRET?: string;
  readonly CF_ACCESS_TOKENS?: string;
  readonly ALLOW_QUICK_RUNS?: string;
  readonly DISABLE_INGEST?: string;
};

type RunRow = {
  readonly run_id: string;
  readonly content_hash: string;
  readonly host_id: string;
  readonly created_at: string;
  readonly uploaded_at: number;
  readonly schema_version: string;
  readonly r2_key: string;
  readonly git_json?: string;
  readonly host_json?: string;
  readonly harness_json?: string;
  readonly scopes_json?: string;
};

type DerivedSummaryPlan =
  | { readonly ok: true; readonly summaries: readonly JsonObject[] }
  | { readonly ok: false; readonly issues: readonly string[] };

type IngestPolicy = {
  readonly allowQuickRuns: boolean;
};

type SampleMeasurement = {
  readonly elapsedNs: number;
  readonly iterations: number;
};

type Stats = {
  readonly min: number;
  readonly max: number;
  readonly q1: number;
  readonly q3: number;
  readonly median: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
  readonly stddev: number;
  readonly mad: number;
  readonly iqr: number;
  readonly outliers: OutlierCounts;
};

type OutlierCounts = {
  readonly lowMild: number;
  readonly highMild: number;
  readonly lowSevere: number;
  readonly highSevere: number;
};

const MAX_POST_BYTES = 10 * 1024 * 1024;

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
  if (envFlag(env.DISABLE_INGEST)) {
    return json({ error: "ingest is disabled for this environment" }, 403);
  }

  if (!(await isAuthorized(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

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

  const r2Key = `${run.runId}/${contentHash}.json`;
  await env.BENCH_RAW_RUNS.put(r2Key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      runId: run.runId,
      contentHash,
      schemaVersion: run.schemaVersion,
    },
  });

  try {
    await insertRun(env, run, contentHash, r2Key, derived.summaries);
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

function ingestPolicy(request: Request, env: Env): IngestPolicy {
  return {
    allowQuickRuns:
      env.ALLOW_QUICK_RUNS === "true" ||
      isLocalTestHost(new URL(request.url).hostname),
  };
}

function envFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
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

function isQuickRun(run: BenchRun): boolean {
  const mode = stringField(run.harness, "mode") ?? stringField(run.harness, "profile");
  return booleanField(run.harness, "quick") === true || mode === "quick";
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
  const limit = readLimit(url, 50, 200);
  const { results = [] } = await env.BENCH_DB.prepare(
    `select runs.run_id, runs.content_hash, runs.host_id, runs.created_at,
            runs.uploaded_at, runs.schema_version, runs.r2_key,
            runs.git_json, runs.host_json, runs.harness_json,
            (
              select json_group_array(run_scopes.scope_json)
                from run_scopes
               where run_scopes.run_id = runs.run_id
            ) as scopes_json
       from runs
      order by created_at desc, uploaded_at desc
      limit ?
      offset ?`,
  )
    .bind(limit, readOffset(url))
    .all<RunRow>();

  return json({ runs: results.map((row) => runMetadata(row, false)) });
}

async function getRun(env: Env, runId: string): Promise<Response> {
  const row = await findRun(env, runId);
  if (!row) {
    return json({ error: "not found" }, 404);
  }

  const object = await env.BENCH_RAW_RUNS.get(row.r2_key);
  if (!object) {
    return json({ error: "raw run is missing" }, 500);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", `"${row.content_hash}"`);
  headers.set("cache-control", "public, max-age=300");
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(object.body, { headers });
}

async function getResults(env: Env, url: URL): Promise<Response> {
  const filters: string[] = [];
  const values: unknown[] = [];

  addFilter(filters, values, "rs.scope_id", url.searchParams.get("scope"));
  addFilter(filters, values, "rs.case_id", url.searchParams.get("case"));
  addFilter(filters, values, "rs.metric", url.searchParams.get("metric"));
  addFilter(filters, values, "runs.run_id", url.searchParams.get("runId"));
  addFilter(filters, values, "runs.host_id", url.searchParams.get("host"));

  values.push(readLimit(url, 200, 1000));
  values.push(readOffset(url));

  const where = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
  const { results = [] } = await env.BENCH_DB.prepare(
    `select runs.run_id, runs.host_id, runs.created_at, runs.schema_version,
            runs.git_json, runs.host_json, runs.harness_json,
            rs.scope_id, rs.case_id, rs.metric, rs.unit, rs.value, rs.summary_json
       from run_summaries rs
       join runs on runs.run_id = rs.run_id
      ${where}
      order by runs.created_at desc, rs.scope_id, rs.case_id, rs.metric
      limit ? offset ?`,
  )
    .bind(...values)
    .all<JsonObject>();

  return json({ results: results.map(resultRow) });
}

async function findRun(env: Env, runId: string): Promise<RunRow | null> {
  return env.BENCH_DB.prepare(
    `select runs.run_id, runs.content_hash, runs.host_id, runs.created_at,
            runs.uploaded_at, runs.schema_version, runs.r2_key,
            runs.git_json, runs.host_json, runs.harness_json,
            (
              select json_group_array(run_scopes.scope_json)
                from run_scopes
               where run_scopes.run_id = runs.run_id
            ) as scopes_json
       from runs
      where runs.run_id = ?`,
  )
    .bind(runId)
    .first<RunRow>();
}

async function insertRun(
  env: Env,
  run: BenchRun,
  contentHash: string,
  r2Key: string,
  summaries: readonly JsonObject[],
): Promise<void> {
  const hostId = hostIdFromHost(run.host);
  const statements: D1PreparedStatement[] = [
    env.BENCH_DB.prepare(
      `insert into runs (
         run_id, content_hash, host_id, created_at, uploaded_at, schema_version, r2_key,
         git_json, host_json, harness_json, checksums_json, warnings_json
       ) values (?, ?, ?, ?, unixepoch(), ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      run.runId,
      contentHash,
      hostId,
      run.createdAt,
      run.schemaVersion,
      r2Key,
      JSON.stringify(run.git),
      JSON.stringify(run.host),
      JSON.stringify(run.harness),
      JSON.stringify(run.checksums),
      JSON.stringify(run.warnings),
    ),
    ...run.scopes.map((scope, index) =>
      env.BENCH_DB.prepare(
        `insert into run_scopes (run_id, scope_id, title, scope_json)
         values (?, ?, ?, ?)`,
      ).bind(
        run.runId,
        stringField(scope, "id") ?? stringField(scope, "scopeId") ?? String(index),
        stringField(scope, "title") ?? stringField(scope, "name") ?? null,
        JSON.stringify(scope),
      ),
    ),
    ...run.cases.map((benchCase, index) =>
      env.BENCH_DB.prepare(
        `insert into run_cases (run_id, case_id, scope_id, name, case_json)
         values (?, ?, ?, ?, ?)`,
      ).bind(
        run.runId,
        caseId(benchCase, index),
        stringField(benchCase, "scopeId") ?? stringField(benchCase, "scope") ?? null,
        stringField(benchCase, "name") ?? stringField(benchCase, "title") ?? null,
        JSON.stringify(benchCase),
      ),
    ),
    ...summaries.map((summary, index) =>
      env.BENCH_DB.prepare(
        `insert into run_summaries (
           run_id, summary_index, scope_id, case_id, metric, unit, value, summary_json
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        run.runId,
        index,
        stringField(summary, "scopeId") ?? stringField(summary, "scope") ?? null,
        stringField(summary, "caseId") ?? stringField(summary, "case") ?? null,
        stringField(summary, "metric") ?? stringField(summary, "name") ?? null,
        stringField(summary, "unit") ?? null,
        numberField(summary, "value") ?? numberField(summary, "mean") ?? null,
        JSON.stringify(summary),
      ),
    ),
  ];

  await env.BENCH_DB.batch(statements);
}

export function deriveSummaries(run: BenchRun): DerivedSummaryPlan {
  const samplesByCase = new Map<string, SampleMeasurement[]>();
  const issues: string[] = [];
  const declaredCaseIds = new Set(
    run.cases.map((benchCase, index) => caseId(benchCase, index)),
  );

  for (const [index, sample] of run.samples.entries()) {
    if (!isObject(sample)) {
      issues.push(`samples[${index}] is not an object`);
      continue;
    }
    const id = stringField(sample, "caseId") ?? stringField(sample, "case");
    const iterations = numberField(sample, "iterations");
    const elapsedNs = numberField(sample, "elapsedNs");
    if (!id || !iterations || !elapsedNs || iterations <= 0 || elapsedNs <= 0) {
      issues.push(`samples[${index}] is missing caseId, iterations, or elapsedNs`);
      continue;
    }
    if (!declaredCaseIds.has(id)) {
      issues.push(`samples[${index}] references unknown caseId ${id}`);
      continue;
    }
    const measurements = samplesByCase.get(id) ?? [];
    measurements.push({ elapsedNs, iterations });
    samplesByCase.set(id, measurements);
  }

  const summaries: JsonObject[] = [];
  for (const [index, benchCase] of run.cases.entries()) {
    const id = caseId(benchCase, index);
    const samples = samplesByCase.get(id);
    if (!samples || samples.length === 0) {
      issues.push(`cases[${index}] ${id} has no samples`);
      continue;
    }

    const input = isObject(benchCase.input) ? benchCase.input : {};
    const inputAmount = numberField(input, "amount");
    const inputUnit = stringField(input, "unit") ?? "operation";
    if (!inputAmount || inputAmount <= 0) {
      issues.push(`cases[${index}] ${id} is missing input.amount`);
      continue;
    }

    const sampleWindowNs = samples.map((sample) => sample.elapsedNs);
    const latencyNsPerIteration = samples.map(
      (sample) => sample.elapsedNs / sample.iterations,
    );
    const windowStats = statsFrom(sampleWindowNs);
    const latencyStats = statsFrom(latencyNsPerIteration);
    if (!windowStats || !latencyStats) {
      issues.push(`cases[${index}] ${id} has no usable samples`);
      continue;
    }

    const throughputValue = inputAmount * 1_000_000_000 / latencyStats.median;
    const relativeStddev = latencyStats.mean > 0 ? latencyStats.stddev / latencyStats.mean : 0;
    const flags = stabilityFlags(run, samples, latencyStats, relativeStddev);
    const totalIterations = samples.reduce((total, sample) => total + sample.iterations, 0);
    const representativeIterations = representativeIterationCount(samples);

    summaries.push({
      schemaVersion: "bench.summary.v1",
      scopeId: stringField(benchCase, "scopeId") ?? stringField(benchCase, "scope") ?? "unknown",
      caseId: id,
      group: stringField(benchCase, "group") ?? "default",
      workloadDescription: stringField(benchCase, "workloadDescription") ?? null,
      benchmark: benchmarkLabel(benchCase, inputAmount, inputUnit),
      algorithm: stringField(benchCase, "algorithm") ?? stringField(benchCase, "name") ?? id,
      algorithmColor: stringField(benchCase, "algorithmColor") ?? null,
      input: {
        kind: stringField(input, "kind") ?? null,
        amount: inputAmount,
        unit: inputUnit,
      },
      metric: "throughput",
      unit: perSecondUnit(inputUnit),
      direction: "higher",
      value: throughputValue,
      sampleCount: samples.length,
      iterationsPerSample: representativeIterations,
      totalIterations,
      stats: {
        sampleWindowNs: statsJson(windowStats),
        perIterationNs: statsJson(latencyStats),
      },
      latency: {
        medianNsPerIter: latencyStats.median,
        p90NsPerIter: latencyStats.p90,
        p95NsPerIter: latencyStats.p95,
        p99NsPerIter: latencyStats.p99,
      },
      outliers: latencyStats.outliers,
      stability: {
        stable: flags.length === 0,
        relativeStddev,
        flags,
      },
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, summaries };
}

function statsFrom(values: readonly number[]): Stats | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(sorted);
  const variance = mean(sorted.map((value) => (value - average) ** 2));
  const median = percentileSorted(sorted, 0.5);
  const q1 = percentileSorted(sorted, 0.25);
  const q3 = percentileSorted(sorted, 0.75);
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((left, right) => left - right);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    q3,
    median,
    p90: percentileSorted(sorted, 0.9),
    p95: percentileSorted(sorted, 0.95),
    p99: percentileSorted(sorted, 0.99),
    mean: average,
    stddev: Math.sqrt(variance),
    mad: percentileSorted(deviations, 0.5),
    iqr: q3 - q1,
    outliers: classifyOutliers(sorted, q1, q3),
  };
}

function statsJson(stats: Stats): JsonObject {
  return {
    min: stats.min,
    max: stats.max,
    q1: stats.q1,
    q3: stats.q3,
    median: stats.median,
    p90: stats.p90,
    p95: stats.p95,
    p99: stats.p99,
    mean: stats.mean,
    stddev: stats.stddev,
    mad: stats.mad,
    iqr: stats.iqr,
  };
}

function percentileSorted(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = percentile * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function classifyOutliers(sorted: readonly number[], q1: number, q3: number): OutlierCounts {
  const iqr = q3 - q1;
  if (iqr <= Number.EPSILON) {
    return { lowMild: 0, highMild: 0, lowSevere: 0, highSevere: 0 };
  }

  const lowMild = q1 - 1.5 * iqr;
  const highMild = q3 + 1.5 * iqr;
  const lowSevere = q1 - 3 * iqr;
  const highSevere = q3 + 3 * iqr;
  let lowMildCount = 0;
  let highMildCount = 0;
  let lowSevereCount = 0;
  let highSevereCount = 0;

  for (const value of sorted) {
    if (value < lowSevere) {
      lowSevereCount += 1;
    } else if (value < lowMild) {
      lowMildCount += 1;
    } else if (value > highSevere) {
      highSevereCount += 1;
    } else if (value > highMild) {
      highMildCount += 1;
    }
  }

  return {
    lowMild: lowMildCount,
    highMild: highMildCount,
    lowSevere: lowSevereCount,
    highSevere: highSevereCount,
  };
}

function stabilityFlags(
  run: BenchRun,
  samples: readonly SampleMeasurement[],
  stats: Stats,
  relativeStddev: number,
): string[] {
  const flags: string[] = [];
  if (relativeStddev > 0.05) {
    flags.push("high_relative_stddev");
  }
  if (stats.mad > stats.median * 0.05) {
    flags.push("high_mad");
  }
  if (outlierTotal(stats.outliers) / samples.length > 0.1) {
    flags.push("high_outlier_fraction");
  }
  if (samples.length < 20) {
    flags.push("low_sample_count");
  }
  if (booleanField(run.harness, "quick")) {
    flags.push("quick_mode");
  }
  if (hasVaryingIterations(samples)) {
    flags.push("varying_iterations");
  }
  return flags;
}

function outlierTotal(outliers: OutlierCounts): number {
  return outliers.lowMild + outliers.highMild + outliers.lowSevere + outliers.highSevere;
}

function representativeIterationCount(samples: readonly SampleMeasurement[]): number {
  if (!hasVaryingIterations(samples)) {
    return samples[0]?.iterations ?? 0;
  }
  return Math.round(percentileSorted(samples.map((sample) => sample.iterations).sort((left, right) => left - right), 0.5));
}

function hasVaryingIterations(samples: readonly SampleMeasurement[]): boolean {
  const first = samples[0]?.iterations;
  return first !== undefined && samples.some((sample) => sample.iterations !== first);
}

function benchmarkLabel(benchCase: JsonObject, inputAmount: number, inputUnit: string): string {
  return (
    stringField(benchCase, "benchmark") ??
    stringField(benchCase, "name") ??
    `${formatInputAmount(inputAmount)} ${shortInputUnit(inputUnit)}`
  );
}

function formatInputAmount(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(4)));
}

function shortInputUnit(unit: string): string {
  return unit.toLowerCase() === "bytes" ? "B" : unit;
}

function perSecondUnit(unit: string): string {
  return unit.toLowerCase() === "bytes" ? "bytes/s" : `${unit}/s`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function booleanField(object: JsonObject, field: string): boolean | undefined {
  const value = object[field];
  return typeof value === "boolean" ? value : undefined;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const tokens = parseUploadTokens(env);
  if (tokens.length === 0) {
    return false;
  }
  const clientId = request.headers.get("cf-access-client-id") ?? "";
  const clientSecret = request.headers.get("cf-access-client-secret") ?? "";
  for (const token of tokens) {
    if (
      (await timingSafeEqual(clientId, token.clientId)) &&
      (await timingSafeEqual(clientSecret, token.clientSecret))
    ) {
      return true;
    }
  }
  return false;
}

export function parseUploadTokens(
  env: Pick<Env, "CF_ACCESS_CLIENT_ID" | "CF_ACCESS_CLIENT_SECRET" | "CF_ACCESS_TOKENS">,
): readonly { readonly clientId: string; readonly clientSecret: string }[] {
  if (env.CF_ACCESS_TOKENS) {
    const value = JSON.parse(env.CF_ACCESS_TOKENS) as unknown;
    if (!Array.isArray(value)) {
      throw new Error("CF_ACCESS_TOKENS must be a JSON array");
    }
    return value.map((item) => {
      if (!isObject(item)) {
        throw new Error("CF_ACCESS_TOKENS entries must be objects");
      }
      const clientId = stringField(item, "clientId");
      const clientSecret = stringField(item, "clientSecret");
      if (!clientId || !clientSecret) {
        throw new Error("CF_ACCESS_TOKENS entries require clientId and clientSecret");
      }
      return { clientId, clientSecret };
    });
  }

  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    return [
      {
        clientId: env.CF_ACCESS_CLIENT_ID,
        clientSecret: env.CF_ACCESS_CLIENT_SECRET,
      },
    ];
  }

  return [];
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
}

async function hashRun(run: BenchRun): Promise<string> {
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

function caseId(benchCase: JsonObject, index: number): string {
  return (
    stringField(benchCase, "id") ??
    stringField(benchCase, "caseId") ??
    String(index)
  );
}

function addFilter(
  filters: string[],
  values: unknown[],
  column: string,
  value: string | null,
): void {
  if (!value) {
    return;
  }
  filters.push(`${column} = ?`);
  values.push(value);
}

function readLimit(url: URL, defaultLimit: number, maxLimit: number): number {
  const requested = Number(url.searchParams.get("limit") ?? defaultLimit);
  if (!Number.isInteger(requested) || requested < 1) {
    return defaultLimit;
  }
  return Math.min(requested, maxLimit);
}

function readOffset(url: URL): number {
  const requested = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(requested) || requested < 0) {
    return 0;
  }
  return requested;
}

function runMetadata(row: RunRow, existing: boolean): JsonObject {
  const host = withHostId(parseJsonObject(row.host_json), row.host_id);
  return {
    existing,
    runId: row.run_id,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    schemaVersion: row.schema_version,
    git: parseJsonObject(row.git_json),
    host,
    harness: parseJsonObject(row.harness_json),
    scopes: parseJsonObjectArray(row.scopes_json),
  };
}

function resultRow(row: JsonObject): JsonObject {
  const hostId = stringField(row, "host_id") ?? "unknown-host";
  return {
    runId: row.run_id,
    createdAt: row.created_at,
    schemaVersion: row.schema_version,
    git: parseJsonObject(row.git_json),
    host: withHostId(parseJsonObject(row.host_json), hostId),
    harness: parseJsonObject(row.harness_json),
    scopeId: row.scope_id,
    caseId: row.case_id,
    metric: row.metric,
    unit: row.unit,
    value: row.value,
    summary: parseJsonObject(row.summary_json),
  };
}

function parseJsonObject(value: unknown): JsonObject {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonObjectArray(value: unknown): readonly JsonObject[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (typeof entry === "string") {
          try {
            const parsedEntry = JSON.parse(entry);
            return isObject(parsedEntry) ? parsedEntry : undefined;
          } catch {
            return undefined;
          }
        }
        return isObject(entry) ? entry : undefined;
      })
      .filter((entry): entry is JsonObject => entry !== undefined);
  } catch {
    return [];
  }
}

function hostIdFromHost(host: JsonObject): string {
  return (
    stringField(host, "id") ??
    slugify(
      [
        stringField(host, "cpu") ?? "unknown-cpu",
        stringField(host, "os") ?? "unknown-os",
        stringField(host, "arch") ?? "unknown-arch",
      ].join("-"),
    )
  );
}

function withHostId(host: JsonObject, hostId: string): JsonObject {
  return {
    ...host,
    id: stringField(host, "id") ?? hostId,
    label: stringField(host, "label") ?? stringField(host, "cpu") ?? hostId,
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unknown-host";
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, cf-access-client-id, cf-access-client-secret, x-bench-content-sha256",
  };
}

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}
