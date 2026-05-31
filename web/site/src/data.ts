import { normalizeColor } from "./colors";
import { formatInputValue, parseBenchmarkAmount } from "./format";
import { latestRunsByHostFromRunBenchmarks } from "./runs";
import type { BenchmarkResult, BenchmarkRun, ExplorerData, ResultsResponse, RunsResponse } from "./types";
import { asRecord, numberValue, slugify, stringValue, uniqueSorted } from "./utils";

export async function loadExplorerData(): Promise<ExplorerData> {
  const runs = await fetchRuns();
  const runsToLoad = latestRunsForKnownBenchmarks(runs);
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

function latestRunsForKnownBenchmarks(runs: BenchmarkRun[]): BenchmarkRun[] {
  const benchmarkNames = uniqueSorted(runs.map((run) => run.benchmarkName).filter((name): name is string => Boolean(name)));
  const byRunId = new Map<string, BenchmarkRun>();
  const sourceBenchmarks = benchmarkNames.length > 0 ? benchmarkNames : [""];
  for (const benchmarkName of sourceBenchmarks) {
    for (const run of latestRunsByHostFromRunBenchmarks(runs, benchmarkName).values()) {
      byRunId.set(run.id, run);
    }
  }
  return [...byRunId.values()];
}

async function fetchResultsForRuns(runs: readonly BenchmarkRun[]): Promise<ResultsResponse> {
  const pages = await mapWithConcurrency(runs, 4, fetchResultsForRun);
  return { results: pages.flatMap((page) => page.results) };
}

async function fetchResultsForRun(run: BenchmarkRun): Promise<ResultsResponse> {
  const pageSize = 1000;
  const results: BenchmarkResult[] = [];
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
  return { results };
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeRuns(response: RunsResponse): BenchmarkRun[] {
  return response.runs
    .map((row): BenchmarkRun | null => {
      const raw = asRecord(row);
      const runId = stringValue(raw.runId);
      const benchmarkName = stringValue(raw.benchmarkName);
      const host = asRecord(raw.host);
      const cpu = stringValue(host.cpu) ?? stringValue(host.label) ?? "Unknown CPU";
      const os = stringValue(host.os) ?? "Unknown OS";
      if (!runId) {
        return null;
      }
      return {
        id: runId,
        label: runId,
        startedAt: stringValue(raw.createdAt) ?? "",
        benchmarkName,
        host: {
          id: stringValue(host.id) ?? slugify(`${cpu}-${os}-${stringValue(host.arch) ?? ""}`),
          label: cpu,
          environment: {
            cpu,
            os,
            kernel: stringValue(host.kernel),
            rustc: stringValue(host.rustc),
            llvm: stringValue(host.llvm),
          },
        },
      };
    })
    .filter((run): run is BenchmarkRun => run !== null);
}

function normalizeResults(response: ResultsResponse): BenchmarkResult[] {
  return response.results
    .map((row): BenchmarkResult | null => {
      const raw = asRecord(row);
      const summary = asRecord(raw.summary);
      const stability = asRecord(summary.stability);
      const latency = asRecord(summary.latency);
      const input = asRecord(summary.input);
      const runId = stringValue(raw.runId);
      const benchmarkName = stringValue(raw.benchmarkName);
      const caseId = stringValue(raw.caseId);
      const value = numberValue(raw.value);
      if (!runId || !benchmarkName || !caseId || value === undefined) {
        return null;
      }
      const metric = stringValue(raw.metric);
      const summaryWorkload = stringValue(summary.workload);
      const parsedWorkload = summaryWorkload ? parseBenchmarkAmount(summaryWorkload) : undefined;
      const inputAmount = numberValue(input.amount) ?? parsedWorkload?.amount;
      const inputUnit = stringValue(input.unit) ?? parsedWorkload?.unit;
      const workloadLabel =
        inputAmount !== undefined
          ? formatInputValue(inputAmount, inputUnit)
          : summaryWorkload ?? caseId;
      return {
        id: `${runId}-${caseId}`,
        runId,
        benchmarkName,
        group: stringValue(summary.group) ?? "default",
        workloadDescription: stringValue(summary.workloadDescription),
        workload: workloadLabel,
        algorithm: stringValue(summary.algorithm) ?? caseId,
        algorithmColor: normalizeColor(stringValue(summary.algorithmColor)),
        metric: metric ?? "throughput",
        unit: stringValue(raw.unit) ?? "",
        value,
        direction: summary.direction === "lower" ? "lower" : "higher",
        inputAmount,
        inputUnit,
        samples: numberValue(summary.sampleCount),
        relativeStdDev: numberValue(stability.relativeStddev),
        tailLatency: {
          medianNsPerIter: numberValue(latency.medianNsPerIter),
          p90NsPerIter: numberValue(latency.p90NsPerIter),
          p95NsPerIter: numberValue(latency.p95NsPerIter),
          p99NsPerIter: numberValue(latency.p99NsPerIter),
        },
      };
    })
    .filter((result): result is BenchmarkResult => result !== null)
    .filter((result) => Number.isFinite(result.value));
}
