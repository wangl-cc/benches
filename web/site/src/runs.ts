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

export function latestRunsByHostForScope(
  runs: BenchmarkRun[],
  results: BenchmarkResult[],
  scope: string,
) {
  const runIdsForScope = new Set(
    results
      .filter((result) => !scope || result.scope === scope)
      .map((result) => result.runId),
  );
  return latestRunsByHost(runs.filter((run) => runIdsForScope.has(run.id)));
}

export function latestRunsByHostFromRunScopes(runs: BenchmarkRun[], scope: string) {
  return latestRunsByHost(
    runs.filter((run) => !scope || !run.scopes || run.scopes.length === 0 || run.scopes.includes(scope)),
  );
}
