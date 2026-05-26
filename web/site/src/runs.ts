import type { BenchmarkResult, BenchmarkRun } from "./types";
import { runTime } from "./format";

export function latestRunsByHost(runs: BenchmarkRun[]) {
  const byHost = new Map<string, BenchmarkRun>();
  for (const run of runs) {
    const current = byHost.get(run.host.id);
    if (!current || runTime(run) > runTime(current)) {
      byHost.set(run.host.id, run);
    }
  }
  return byHost;
}

export function latestRunsByHostForBenchmark(
  runs: BenchmarkRun[],
  results: BenchmarkResult[],
  benchmarkName: string,
) {
  const runIdsForBenchmark = new Set(
    results
      .filter((result) => !benchmarkName || result.benchmarkName === benchmarkName)
      .map((result) => result.runId),
  );
  return latestRunsByHost(runs.filter((run) => runIdsForBenchmark.has(run.id)));
}

export function latestRunsByHostFromRunBenchmarks(runs: BenchmarkRun[], benchmarkName: string) {
  return latestRunsByHost(
    runs.filter((run) => !benchmarkName || !run.benchmarkName || run.benchmarkName === benchmarkName),
  );
}
