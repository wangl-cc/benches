import { normalizeColor } from "./colors";
import { formatInputValue, parseBenchmarkAmount } from "./format";
import { latestRunsByHostFromRunScopes } from "./runs";
import type { BenchmarkResult, BenchmarkRun, ExplorerData, ResultsResponse, RunsResponse } from "./types";
import { arrayValue, asRecord, numberValue, slugify, stringValue, uniqueSorted } from "./utils";

export async function loadExplorerData(): Promise<ExplorerData> {
  const runs = await fetchRuns();
  const runsToLoad = latestRunsForKnownScopes(runs);
  const resultsJson = await fetchResultsForRuns(runsToLoad);
  const results = normalizeResults(resultsJson);
  if (runs.length === 0 || results.length === 0) {
    throw new Error("API returned no benchmark runs or results");
  }
  return { runs, results, source: "api" };
}

async function fetchRuns(): Promise<BenchmarkRun[]> {
  const pageSize = 200;
  const runs: BenchmarkRun[] = [];
  let offset = 0;
  for (;;) {
    const response = await fetch(`/api/runs?limit=${pageSize}&offset=${offset}`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status} for runs`);
    }
    const page = normalizeRuns((await response.json()) as RunsResponse);
    runs.push(...page);
    if (page.length < pageSize) {
      return runs;
    }
    offset += pageSize;
  }
}

function latestRunsForKnownScopes(runs: BenchmarkRun[]): BenchmarkRun[] {
  const scopes = uniqueSorted(runs.flatMap((run) => run.scopes ?? []));
  const byRunId = new Map<string, BenchmarkRun>();
  const sourceScopes = scopes.length > 0 ? scopes : [""];
  for (const scope of sourceScopes) {
    for (const run of latestRunsByHostFromRunScopes(runs, scope).values()) {
      byRunId.set(run.id, run);
    }
  }
  return [...byRunId.values()];
}

async function fetchResultsForRuns(runs: readonly BenchmarkRun[]): Promise<ResultsResponse> {
  const pageSize = 1000;
  const results: BenchmarkResult[] = [];
  for (const run of runs) {
    let offset = 0;
    for (;;) {
      const response = await fetch(
        `/api/results?runId=${encodeURIComponent(run.id)}&limit=${pageSize}&offset=${offset}`,
      );
      if (!response.ok) {
        throw new Error(`API returned ${response.status} for results of ${run.id}`);
      }
      const page = (await response.json()) as ResultsResponse;
      const pageRows = Array.isArray(page) ? page : page.results;
      results.push(...pageRows);
      if (pageRows.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
  }
  return { results };
}

function normalizeRuns(response: RunsResponse): BenchmarkRun[] {
  const rows = Array.isArray(response) ? response : response.runs;
  return rows
    .map((row): BenchmarkRun | null => {
      const raw = asRecord(row);
      const runId = stringValue(raw.id) ?? stringValue(raw.runId);
      const scopes = parseScopeIds(raw.scopes);
      const host = asRecord(raw.host);
      const environment = asRecord(host.environment ?? host);
      const cpu = stringValue(environment.cpu) ?? stringValue(host.cpu) ?? "Unknown CPU";
      const os = stringValue(environment.os) ?? stringValue(host.os) ?? "Unknown OS";
      if (!runId) {
        return null;
      }
      return {
        id: runId,
        label: stringValue(raw.label) ?? runId,
        startedAt: stringValue(raw.startedAt) ?? stringValue(raw.createdAt) ?? "",
        completedAt: stringValue(raw.completedAt),
        commit: stringValue(raw.commit) ?? stringValue(asRecord(raw.git).commit),
        branch: stringValue(raw.branch) ?? stringValue(asRecord(raw.git).branch),
        resultGroup: stringValue(raw.resultGroup) ?? stringValue(raw.schemaVersion),
        scopes,
        host: {
          id: stringValue(host.id) ?? slugify(`${cpu}-${os}-${stringValue(environment.arch) ?? ""}`),
          label: stringValue(host.label) ?? cpu,
          environment: {
            cpu,
            os,
            kernel: stringValue(environment.kernel),
            rustc: stringValue(environment.rustc),
            llvm: stringValue(environment.llvm),
            memory: stringValue(environment.memory),
          },
        },
      };
    })
    .filter((run): run is BenchmarkRun => run !== null);
}

function parseScopeIds(value: unknown): string[] | undefined {
  const scopes = arrayValue(value)
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      const raw = asRecord(entry);
      return stringValue(raw.id) ?? stringValue(raw.scopeId);
    })
    .filter((scope): scope is string => Boolean(scope));
  return scopes.length > 0 ? uniqueSorted(scopes) : undefined;
}

function normalizeResults(response: ResultsResponse): BenchmarkResult[] {
  const rows = Array.isArray(response) ? response : response.results;
  return rows
    .map((row): BenchmarkResult | null => {
      const raw = asRecord(row);
      const summary = asRecord(raw.summary ?? raw);
      const stability = asRecord(summary.stability);
      const throughput = asRecord(summary.throughput);
      const latency = asRecord(summary.latency);
      const input = asRecord(summary.input);
      const runId = stringValue(raw.runId);
      const caseId = stringValue(raw.caseId) ?? stringValue(summary.caseId);
      const value = numberValue(raw.value) ?? numberValue(summary.value) ?? numberValue(throughput.value);
      if (!runId || !caseId || value === undefined) {
        return null;
      }
      const metric = stringValue(raw.metric) ?? stringValue(summary.metric) ?? "throughput";
      const parsedBenchmark = parseBenchmarkAmount(stringValue(summary.benchmark) ?? caseId);
      const inputAmount = numberValue(input.amount) ?? parsedBenchmark?.amount;
      const inputUnit = stringValue(input.unit) ?? parsedBenchmark?.unit;
      const benchmarkLabel =
        inputAmount !== undefined
          ? formatInputValue(inputAmount, inputUnit)
          : stringValue(raw.benchmark) ?? stringValue(summary.benchmark) ?? caseId;
      const flags = arrayValue(stability.flags).filter((flag): flag is string => typeof flag === "string");
      return {
        id: `${runId}-${caseId}`,
        runId,
        scope: stringValue(raw.scope) ?? stringValue(raw.scopeId) ?? stringValue(summary.scopeId) ?? "unknown",
        group: stringValue(raw.group) ?? stringValue(summary.group) ?? "default",
        workloadDescription: stringValue(raw.workloadDescription) ?? stringValue(summary.workloadDescription),
        benchmark: benchmarkLabel,
        algorithm: stringValue(raw.algorithm) ?? stringValue(summary.algorithm) ?? caseId,
        algorithmColor: normalizeColor(stringValue(raw.algorithmColor) ?? stringValue(summary.algorithmColor)),
        metric,
        unit: stringValue(raw.unit) ?? stringValue(summary.unit) ?? stringValue(throughput.unit) ?? "",
        value,
        direction:
          raw.direction === "lower" || summary.direction === "lower" || metric.toLowerCase().includes("latency")
            ? "lower"
            : "higher",
        inputAmount,
        inputUnit,
        samples: numberValue(raw.samples) ?? numberValue(summary.sampleCount),
        relativeStdDev:
          numberValue(raw.relativeStdDev) ??
          numberValue(summary.relativeStdDev) ??
          numberValue(stability.relativeStddev) ??
          numberValue(stability.relativeStdDev),
        tailLatency: {
          medianNsPerIter: numberValue(latency.medianNsPerIter),
          p90NsPerIter: numberValue(latency.p90NsPerIter),
          p95NsPerIter: numberValue(latency.p95NsPerIter),
          p99NsPerIter: numberValue(latency.p99NsPerIter),
        },
        anomaly:
          flags.length > 0
            ? {
                level: flags.some((flag) => flag.includes("high")) ? "warning" : "info",
                message: flags.join(", "),
              }
            : undefined,
      };
    })
    .filter((result): result is BenchmarkResult => result !== null)
    .filter((result) => Number.isFinite(result.value));
}
