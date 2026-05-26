import {
  type BenchRun,
  type JsonObject,
  isObject,
  numberField,
  stringField,
} from "../../packages/bench-schema/src/index.ts";
import type { CompressedRawRun } from "./raw-json.ts";
import { benchmarkName, runCaseEntries } from "./summaries.ts";
import type { Env, RawRunRow, RunRow } from "./types.ts";

export async function listRunRows(
  env: Env,
  limit: number,
  offset: number,
): Promise<readonly RunRow[]> {
  const { results = [] } = await env.BENCH_DB.prepare(
    `select runs.run_id, runs.content_hash, runs.host_id, runs.benchmark_name, runs.created_at,
            runs.uploaded_at, runs.schema_version,
            runs.git_json, runs.host_json, runs.harness_json
       from runs
      order by created_at desc, uploaded_at desc
      limit ?
      offset ?`,
  )
    .bind(limit, offset)
    .all<RunRow>();
  return results;
}

export async function resultRows(
  env: Env,
  filters: readonly string[],
  values: readonly unknown[],
): Promise<readonly JsonObject[]> {
  const where = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
  const { results = [] } = await env.BENCH_DB.prepare(
    `select runs.run_id, runs.host_id, runs.created_at, runs.schema_version,
            runs.git_json, runs.host_json, runs.harness_json,
            rs.benchmark_name, rs.case_id, rs.metric, rs.unit, rs.value, rs.summary_json
       from run_summaries rs
       join runs on runs.run_id = rs.run_id
      ${where}
      order by runs.created_at desc, rs.benchmark_name, rs.case_id, rs.metric
      limit ? offset ?`,
  )
    .bind(...values)
    .all<JsonObject>();
  return results;
}

export async function findRun(env: Env, runId: string): Promise<RunRow | null> {
  return env.BENCH_DB.prepare(
    `select runs.run_id, runs.content_hash, runs.host_id, runs.benchmark_name, runs.created_at,
            runs.uploaded_at, runs.schema_version,
            runs.git_json, runs.host_json, runs.harness_json
       from runs
      where runs.run_id = ?`,
  )
    .bind(runId)
    .first<RunRow>();
}

export async function findRawRun(env: Env, runId: string): Promise<RawRunRow | null> {
  return env.BENCH_DB.prepare(
    `select content_hash, raw_json_gzip, raw_json_encoding
       from runs
      where run_id = ?`,
  )
    .bind(runId)
    .first<RawRunRow>();
}

export async function insertRun(
  env: Env,
  run: BenchRun,
  contentHash: string,
  rawRun: CompressedRawRun,
  summaries: readonly JsonObject[],
): Promise<void> {
  const hostId = hostIdFromHost(run.host);
  const runBenchmarkName = benchmarkName(run);
  const statements: D1PreparedStatement[] = [
    env.BENCH_DB.prepare(
      `insert into runs (
         run_id, content_hash, host_id, benchmark_name, created_at, uploaded_at, schema_version,
         raw_json_gzip, raw_json_encoding, raw_json_bytes, raw_json_gzip_bytes,
         git_json, host_json, harness_json
       ) values (?, ?, ?, ?, ?, unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      run.runId,
      contentHash,
      hostId,
      runBenchmarkName,
      run.createdAt,
      run.schemaVersion,
      rawRun.bytes,
      "gzip",
      rawRun.originalBytes,
      rawRun.compressedBytes,
      JSON.stringify(run.git),
      JSON.stringify(run.host),
      JSON.stringify(run.harness),
    ),
    ...runCaseEntries(run).map((benchCase) =>
      env.BENCH_DB.prepare(
        `insert into run_cases (run_id, case_id, benchmark_name, name, case_json)
         values (?, ?, ?, ?, ?)`,
      ).bind(
        run.runId,
        stringField(benchCase, "id"),
        stringField(benchCase, "benchmarkName"),
        stringField(benchCase, "name"),
        JSON.stringify(benchCase),
      ),
    ),
    ...summaries.map((summary, index) =>
      env.BENCH_DB.prepare(
        `insert into run_summaries (
           run_id, summary_index, benchmark_name, case_id, metric, unit, value, summary_json
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        run.runId,
        index,
        stringField(summary, "benchmarkName"),
        stringField(summary, "caseId"),
        stringField(summary, "metric"),
        stringField(summary, "unit"),
        numberField(summary, "value"),
        JSON.stringify(summary),
      ),
    ),
  ];

  await env.BENCH_DB.batch(statements);
}

export function runMetadata(row: RunRow, existing: boolean): JsonObject {
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
    benchmarkName: row.benchmark_name,
  };
}

export function resultRow(row: JsonObject): JsonObject {
  const hostId = stringField(row, "host_id") ?? "unknown-host";
  return {
    runId: row.run_id,
    createdAt: row.created_at,
    schemaVersion: row.schema_version,
    git: parseJsonObject(row.git_json),
    host: withHostId(parseJsonObject(row.host_json), hostId),
    harness: parseJsonObject(row.harness_json),
    benchmarkName: row.benchmark_name,
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
    label: stringField(host, "cpu") ?? hostId,
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "unknown-host";
}
