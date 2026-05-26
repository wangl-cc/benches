import type { JsonObject } from "../../packages/bench-schema/src/index.ts";

export type Env = {
  readonly BENCH_DB: D1Database;
  readonly CF_ACCESS_TOKENS?: string;
  readonly ALLOW_QUICK_RUNS?: string;
};

export type RunRow = {
  readonly run_id: string;
  readonly content_hash: string;
  readonly host_id: string;
  readonly benchmark_name: string;
  readonly created_at: string;
  readonly uploaded_at: number;
  readonly schema_version: string;
  readonly git_json?: string;
  readonly host_json?: string;
  readonly harness_json?: string;
};

export type RawRunRow = {
  readonly content_hash: string;
  readonly raw_json_gzip: StoredRawBytes;
  readonly raw_json_encoding: string;
};

export type StoredRawBytes = ArrayBuffer | Uint8Array | readonly number[];

export type IngestPolicy = {
  readonly allowQuickRuns: boolean;
};

export type DerivedSummaryPlan =
  | { readonly ok: true; readonly summaries: readonly JsonObject[] }
  | { readonly ok: false; readonly issues: readonly string[] };
