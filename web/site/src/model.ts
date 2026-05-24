import { buildAlgorithmColorMap, colorForAlgorithm } from "./colors";
import {
  formatInputValue,
  formatLatencyValue,
  formatMetricValue,
  formatNumber,
  formatRsd,
  parseBenchmarkAmount,
  compactRunLabel,
} from "./format";
import { latestRunsByHostForScope } from "./runs";
import type {
  BenchmarkResult,
  ExplorerData,
  ExplorerModel,
  ExplorerModelState,
  GroupedBarGroup,
  RankingGroup,
  ResultRow,
  TailLatencyMetric,
  TailLatencyRow,
  TrendSeries,
} from "./types";
import { uniqueBy, uniqueSorted } from "./utils";

export const AUTO_BENCHMARK = "Auto range";
export const THROUGHPUT_METRIC = "throughput";
const platformDashes = ["", "6 4", "2 4", "10 4"];

export function buildExplorerModel(data: ExplorerData, state: ExplorerModelState): ExplorerModel {
  const runById = new Map(data.runs.map((run) => [run.id, run]));
  const latestRunByHost = latestRunsByHostForScope(data.runs, data.results, state.scope);
  const hosts = uniqueBy([...latestRunByHost.values()], (run) => run.host.id).map((run) => ({
    id: run.host.id,
    label: run.host.label,
    cpu: run.host.environment.cpu,
    environment: run.host.environment,
  }));
  const selectedHostIds = reconcileSelection(
    state.platformIds,
    hosts.map((host) => host.id),
    3,
  );
  const selectedRunIds = new Set(
    selectedHostIds.map((hostId) => latestRunByHost.get(hostId)?.id).filter((id): id is string => Boolean(id)),
  );
  const scopes = uniqueSorted(data.results.map((result) => result.scope));
  const scopedRows = data.results.filter((result) => !state.scope || result.scope === state.scope);
  const groups = uniqueSorted(scopedRows.map((result) => result.group));
  const groupedRows = scopedRows.filter((result) => !state.group || result.group === state.group);
  const throughputRows = groupedRows.filter((result) => result.metric === THROUGHPUT_METRIC);
  const rawBenchmarks = sortBenchmarks(uniqueSorted(throughputRows.map((result) => result.benchmark)));
  const benchmarks = rawBenchmarks.length > 1 ? [autoBenchmarkLabel(rawBenchmarks), ...rawBenchmarks] : rawBenchmarks;
  const selectedBenchmark = state.benchmark.startsWith(AUTO_BENCHMARK) ? "" : state.benchmark;
  const search = state.query.trim().toLowerCase();
  const searchedRows = throughputRows.filter((result) =>
    search ? `${result.algorithm} ${result.benchmark} ${result.group}`.toLowerCase().includes(search) : true,
  );
  const matchingAlgorithms = uniqueSorted(searchedRows.map((result) => result.algorithm));
  const availableAlgorithms = search ? matchingAlgorithms : uniqueSorted(throughputRows.map((result) => result.algorithm));
  const algorithmColors = buildAlgorithmColorMap(searchedRows);
  const selectedAlgorithms = reconcileSelection(state.algorithmIds, availableAlgorithms, 4);
  const effectiveAlgorithms = effectiveAlgorithmSelection(selectedAlgorithms, matchingAlgorithms, search);
  const toResultRow = (result: BenchmarkResult): ResultRow => {
    const run = runById.get(result.runId);
    return {
      ...result,
      hostId: run?.host.id ?? "unknown",
      hostLabel: run?.host.label ?? "Unknown platform",
      runLabel: run ? compactRunLabel(run) : "",
    };
  };
  const trendRows: ResultRow[] = searchedRows
    .filter((result) => selectedRunIds.has(result.runId))
    .filter((result) => effectiveAlgorithms.includes(result.algorithm))
    .map(toResultRow);
  const representativeBenchmark = selectedBenchmark || representativeBenchmarkFor(trendRows);
  const autoBenchmark = benchmarks.find((item) => item.startsWith(AUTO_BENCHMARK)) ?? representativeBenchmark;
  const visibleRows = trendRows.filter((result) => !representativeBenchmark || result.benchmark === representativeBenchmark);
  const trendSeries = buildTrendSeries(trendRows);
  const rankingGroups = buildRankingGroups(visibleRows, state.rankingGroup);
  const unit = trendRows[0]?.unit ?? throughputRows[0]?.unit ?? "";
  const workloadDescription = singleWorkloadDescription(visibleRows);
  return {
    hosts,
    selectedHostIds,
    scopes,
    groups,
    workloadDescription,
    benchmarks,
    representativeBenchmark,
    autoBenchmark,
    availableAlgorithms,
    algorithmColors,
    selectedAlgorithms,
    visibleRows,
    trendSeries,
    rankingGroups,
    unit,
  };
}

export function deriveDefaults(data: ExplorerData) {
  const scope = uniqueSorted(data.results.map((result) => result.scope))[0] ?? "";
  const group = uniqueSorted(data.results.filter((result) => result.scope === scope).map((result) => result.group))[0] ?? "";
  const throughputRows = data.results
    .filter((result) => result.scope === scope)
    .filter((result) => result.group === group)
    .filter((result) => result.metric === THROUGHPUT_METRIC);
  const rawBenchmarks = sortBenchmarks(uniqueSorted(throughputRows.map((result) => result.benchmark)));
  const benchmark = rawBenchmarks.length > 1 ? autoBenchmarkLabel(rawBenchmarks) : (rawBenchmarks[0] ?? "");
  const hosts = [...latestRunsByHostForScope(data.runs, data.results, scope).values()];
  const algorithmIds = uniqueSorted(throughputRows.map((result) => result.algorithm)).slice(0, 4);
  return {
    scope,
    group,
    benchmark,
    platformIds: hosts.slice(0, 3).map((run) => run.host.id),
    algorithmIds,
  };
}

function reconcileSelection(selected: string[], available: string[], defaultCount: number): string[] {
  const availableSet = new Set(available);
  const retained = selected.filter((item) => availableSet.has(item));
  return retained.length > 0 ? retained : available.slice(0, defaultCount);
}

export function buildTrendSeries(rows: ResultRow[]): TrendSeries[] {
  const bySeries = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const parsedInput = parseBenchmarkAmount(row.benchmark);
    const amount = row.inputAmount ?? parsedInput?.amount;
    if (!amount || amount <= 0) {
      continue;
    }
    const key = `${row.algorithm}\0${row.hostId}`;
    const list = bySeries.get(key) ?? [];
    list.push({ ...row, inputAmount: amount, inputUnit: row.inputUnit ?? parsedInput?.unit });
    bySeries.set(key, list);
  }
  const platforms = uniqueSorted(rows.map((row) => row.hostId));
  return [...bySeries.entries()]
    .map(([id, list]) => {
      const first = list[0];
      const platformIndex = Math.max(0, platforms.indexOf(first.hostId));
      return {
        id,
        algorithm: first.algorithm,
        hostId: first.hostId,
        platform: first.hostLabel,
        color: colorForAlgorithm(first.algorithm, first.algorithmColor),
        dash: platformDashes[platformIndex % platformDashes.length],
        points: list
          .sort((left, right) => (left.inputAmount ?? 0) - (right.inputAmount ?? 0))
          .map((row) => ({
            x: row.inputAmount ?? 0,
            y: row.value,
            label: row.benchmark,
            unit: row.inputUnit,
          })),
      };
    })
    .filter((series) => series.points.length > 1);
}

export function buildRankingGroups(rows: ResultRow[], mode: RankingGroup): GroupedBarGroup[] {
  const direction = rows[0]?.direction ?? "higher";
  return buildGroupedBarGroups({
    rows,
    mode,
    valueOf: (row) => row.value,
    sortDirection: direction === "higher" ? "desc" : "asc",
    valueLabel: (row) => formatMetricValue(row.value, row.unit),
    rowIdSuffix: "throughput",
  });
}

export function buildTailLatencyBands(
  rows: ResultRow[],
  metric: TailLatencyMetric,
  mode: RankingGroup,
): Array<{ id: string; label: string; rows: TailLatencyRow[] }> {
  return buildGroupedBarGroups({
    rows,
    mode,
    valueOf: (row) => tailLatencyValue(row, metric),
    sortDirection: "asc",
    valueLabel: (_row, value) => formatLatencyValue(value),
    rowIdSuffix: metric,
  }).map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      const source = rows.find((candidate) => candidate.id === row.sourceId);
      return {
        ...row,
        p50: source?.tailLatency?.medianNsPerIter,
        p90: source?.tailLatency?.p90NsPerIter,
        p95: source?.tailLatency?.p95NsPerIter,
      };
    }),
  }));
}

export function buildStabilityGroups(rows: ResultRow[], mode: RankingGroup): GroupedBarGroup[] {
  return buildGroupedBarGroups({
    rows,
    mode,
    valueOf: (row) => row.relativeStdDev,
    sortDirection: "asc",
    valueLabel: (row) => `${formatRsd(row.relativeStdDev)} RSD`,
    rowIdSuffix: "stability",
  });
}

function buildGroupedBarGroups({
  rows,
  mode,
  valueOf,
  sortDirection,
  valueLabel,
  rowIdSuffix,
}: {
  rows: ResultRow[];
  mode: RankingGroup;
  valueOf: (row: ResultRow) => number | undefined;
  sortDirection: "asc" | "desc";
  valueLabel: (row: ResultRow, value: number) => string;
  rowIdSuffix: string;
}): GroupedBarGroup[] {
  const valuedRows = rows
    .map((row) => ({ row, value: valueOf(row) }))
    .filter((entry): entry is { row: ResultRow; value: number } => entry.value !== undefined && Number.isFinite(entry.value));
  const maxValue = Math.max(...valuedRows.map((entry) => entry.value), 1);
  const groupKey = mode === "algorithm" ? (row: ResultRow) => row.algorithm : (row: ResultRow) => row.hostId;
  const groupLabel = mode === "algorithm" ? (row: ResultRow) => row.algorithm : (row: ResultRow) => row.hostLabel;
  const rowLabel = mode === "algorithm" ? (row: ResultRow) => row.hostLabel : (row: ResultRow) => row.algorithm;
  const groups = new Map<string, { label: string; rows: Array<{ row: ResultRow; value: number }> }>();
  for (const entry of valuedRows) {
    const key = groupKey(entry.row);
    const group = groups.get(key) ?? { label: groupLabel(entry.row), rows: [] };
    group.rows.push(entry);
    groups.set(key, group);
  }
  const sortEntries = (left: { value: number }, right: { value: number }) =>
    sortDirection === "desc" ? right.value - left.value : left.value - right.value;
  return [...groups.entries()]
    .map(([id, group]) => {
      const sortedRows = group.rows.sort(sortEntries);
      return {
        id,
        label: group.label,
        rankValue: sortedRows[0]?.value ?? 0,
        rows: sortedRows.slice(0, 4).map(({ row, value }) => ({
          id: `${row.id}-${row.hostId}-${rowIdSuffix}`,
          sourceId: row.id,
          label: rowLabel(row),
          algorithm: row.algorithm,
          hostId: row.hostId,
          platform: row.hostLabel,
          value,
          score: value / maxValue,
          valueLabel: valueLabel(row, value),
          color: colorForAlgorithm(row.algorithm, row.algorithmColor),
          samples: row.samples,
          relativeStdDev: row.relativeStdDev,
          detail: measurementDetail(row),
        })),
      };
    })
    .sort((left, right) =>
      sortDirection === "desc"
        ? right.rankValue - left.rankValue
        : left.rankValue - right.rankValue,
    )
    .map(({ rankValue: _rankValue, ...group }) => group);
}

function measurementDetail(row: ResultRow) {
  return `${row.algorithm} on ${row.hostLabel}: ${formatRsd(row.relativeStdDev)} RSD, ${formatNumber.format(row.samples ?? 0)} samples`;
}

function autoBenchmarkLabel(benchmarks: string[]) {
  const inputs = benchmarks
    .map(parseBenchmarkAmount)
    .filter((input): input is { amount: number; unit: string } => input !== undefined)
    .sort((left, right) => left.amount - right.amount);
  if (inputs.length < 2) {
    return AUTO_BENCHMARK;
  }
  const first = inputs[0];
  const last = inputs[inputs.length - 1];
  return `${AUTO_BENCHMARK} (${formatInputValue(first.amount, first.unit)} - ${formatInputValue(last.amount, last.unit)})`;
}

function sortBenchmarks(benchmarks: string[]) {
  return [...benchmarks].sort((left, right) => {
    const leftAmount = parseBenchmarkAmount(left)?.amount;
    const rightAmount = parseBenchmarkAmount(right)?.amount;
    if (leftAmount !== undefined && rightAmount !== undefined) {
      return leftAmount - rightAmount;
    }
    if (leftAmount !== undefined) {
      return -1;
    }
    if (rightAmount !== undefined) {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function representativeBenchmarkFor(rows: ResultRow[]) {
  const byBenchmark = new Map<string, number>();
  for (const row of rows) {
    const amount = row.inputAmount ?? parseBenchmarkAmount(row.benchmark)?.amount;
    if (amount) {
      byBenchmark.set(row.benchmark, amount);
    }
  }
  const candidates = [...byBenchmark.entries()].sort((left, right) => left[1] - right[1]);
  return candidates.find(([, amount]) => amount >= 4096)?.[0] ?? candidates[candidates.length - 1]?.[0] ?? "";
}

function effectiveAlgorithmSelection(
  selectedAlgorithms: string[],
  matchingAlgorithms: string[],
  query: string,
) {
  if (!query) {
    return selectedAlgorithms;
  }
  const selectedMatches = selectedAlgorithms.filter((algorithm) => matchingAlgorithms.includes(algorithm));
  return selectedMatches.length > 0 ? selectedMatches : matchingAlgorithms;
}

function singleWorkloadDescription(rows: ResultRow[]): string | undefined {
  const descriptions = uniqueSorted(
    rows.map((row) => row.workloadDescription?.trim()).filter((description): description is string => Boolean(description)),
  );
  return descriptions.length === 1 ? descriptions[0] : undefined;
}

function tailLatencyValue(row: BenchmarkResult, metric: TailLatencyMetric): number | undefined {
  if (metric === "p50") {
    const median = row.tailLatency?.medianNsPerIter;
    return median !== undefined && Number.isFinite(median) ? median : undefined;
  }
  const value = row.tailLatency?.[`${metric}NsPerIter`];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}
