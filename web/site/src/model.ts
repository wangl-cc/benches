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
import { latestRunsByHostForBenchmark } from "./runs";
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
import { labelize, uniqueBy, uniqueSorted } from "./utils";

export const AUTO_WORKLOAD = "Auto range";
export const THROUGHPUT_METRIC = "throughput";
const platformDashes = ["", "6 4", "2 4", "10 4"];

export function buildExplorerModel(data: ExplorerData, state: ExplorerModelState): ExplorerModel {
  const runById = new Map(data.runs.map((run) => [run.id, run]));
  const latestRunByHost = latestRunsByHostForBenchmark(data.runs, data.results, state.benchmarkName);
  const hosts = disambiguateHosts(
    uniqueBy([...latestRunByHost.values()], (run) => run.host.id).map((run) => ({
      id: run.host.id,
      label: run.host.label,
      cpu: run.host.environment.cpu,
      environment: run.host.environment,
    })),
  );
  const hostLabels = new Map(hosts.map((host) => [host.id, host.label]));
  const selectedHostIds = reconcileSelection(
    state.platformIds,
    hosts.map((host) => host.id),
    3,
  );
  const selectedRunIds = new Set(
    selectedHostIds.map((hostId) => latestRunByHost.get(hostId)?.id).filter((id): id is string => Boolean(id)),
  );
  const benchmarkNames = sortBenchmarkNames(uniqueSorted(data.results.map((result) => result.benchmarkName)));
  const benchmarkRows = data.results.filter((result) => !state.benchmarkName || result.benchmarkName === state.benchmarkName);
  const groups = uniqueSorted(benchmarkRows.map((result) => result.group));
  const groupedRows = benchmarkRows.filter((result) => !state.group || result.group === state.group);
  const throughputRows = groupedRows.filter((result) => result.metric === THROUGHPUT_METRIC);
  const rawWorkloads = sortWorkloads(uniqueSorted(throughputRows.map((result) => result.workload)));
  const workloads = rawWorkloads.length > 1 ? [autoWorkloadLabel(rawWorkloads), ...rawWorkloads] : rawWorkloads;
  const selectedWorkload = state.workload.startsWith(AUTO_WORKLOAD) ? "" : state.workload;
  const search = state.query.trim().toLowerCase();
  const searchedRows = throughputRows.filter((result) =>
    search ? `${result.algorithm} ${result.workload} ${result.group}`.toLowerCase().includes(search) : true,
  );
  const matchingAlgorithms = uniqueSorted(searchedRows.map((result) => result.algorithm));
  const availableAlgorithms = uniqueSorted(throughputRows.map((result) => result.algorithm));
  const visibleAlgorithms = search ? matchingAlgorithms : availableAlgorithms;
  const algorithmColors = buildAlgorithmColorMap(throughputRows);
  const selectedAlgorithms = reconcileSelectionWithDefault(state.algorithmIds, availableAlgorithms);
  const effectiveAlgorithms = effectiveAlgorithmSelection(selectedAlgorithms, matchingAlgorithms, search);
  const toResultRow = (result: BenchmarkResult): ResultRow => {
    const run = runById.get(result.runId);
    return {
      ...result,
      hostId: run?.host.id ?? "unknown",
      hostLabel: run ? hostLabels.get(run.host.id) ?? run.host.label : "Unknown platform",
      runLabel: run ? compactRunLabel(run) : "",
    };
  };
  const trendRows: ResultRow[] = searchedRows
    .filter((result) => selectedRunIds.has(result.runId))
    .filter((result) => effectiveAlgorithms.includes(result.algorithm))
    .map(toResultRow);
  const representativeWorkload = selectedWorkload || representativeWorkloadFor(trendRows);
  const autoWorkload = workloads.find((item) => item.startsWith(AUTO_WORKLOAD)) ?? representativeWorkload;
  const visibleRows = trendRows.filter((result) => !representativeWorkload || result.workload === representativeWorkload);
  const trendSeries = buildTrendSeries(trendRows);
  const rankingGroups = buildRankingGroups(visibleRows, state.rankingGroup);
  const unit = trendRows[0]?.unit ?? throughputRows[0]?.unit ?? "";
  const workloadDescription = singleWorkloadDescription(visibleRows);
  return {
    hosts,
    selectedHostIds,
    benchmarkNames,
    groups,
    workloadDescription,
    workloads,
    representativeWorkload,
    autoWorkload,
    availableAlgorithms,
    visibleAlgorithms,
    algorithmColors,
    selectedAlgorithms,
    visibleRows,
    trendSeries,
    rankingGroups,
    unit,
  };
}

export function deriveDefaults(data: ExplorerData) {
  const benchmarkName = sortBenchmarkNames(uniqueSorted(data.results.map((result) => result.benchmarkName)))[0] ?? "";
  const group = uniqueSorted(data.results.filter((result) => result.benchmarkName === benchmarkName).map((result) => result.group))[0] ?? "";
  const throughputRows = data.results
    .filter((result) => result.benchmarkName === benchmarkName)
    .filter((result) => result.group === group)
    .filter((result) => result.metric === THROUGHPUT_METRIC);
  const rawWorkloads = sortWorkloads(uniqueSorted(throughputRows.map((result) => result.workload)));
  const workload = rawWorkloads.length > 1 ? autoWorkloadLabel(rawWorkloads) : (rawWorkloads[0] ?? "");
  const hosts = [...latestRunsByHostForBenchmark(data.runs, data.results, benchmarkName).values()];
  const availableAlgorithms = uniqueSorted(throughputRows.map((result) => result.algorithm));
  return {
    benchmarkName,
    group,
    workload,
    platformIds: hosts.slice(0, 3).map((run) => run.host.id),
    algorithmIds: availableAlgorithms,
  };
}

function reconcileSelection(selected: string[], available: string[], defaultCount: number): string[] {
  const availableSet = new Set(available);
  const retained = selected.filter((item) => availableSet.has(item));
  return retained.length > 0 ? retained : available.slice(0, defaultCount);
}

function reconcileSelectionWithDefault(
  selected: string[],
  available: string[],
): string[] {
  const availableSet = new Set(available);
  const retained = selected.filter((item) => availableSet.has(item));
  if (retained.length > 0) {
    return retained;
  }
  return available;
}

export function buildTrendSeries(rows: ResultRow[]): TrendSeries[] {
  const bySeries = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const parsedInput = parseBenchmarkAmount(row.workload);
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
            label: row.workload,
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
        p99: source?.tailLatency?.p99NsPerIter,
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
        rows: sortedRows.map(({ row, value }) => ({
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

function autoWorkloadLabel(workloads: string[]) {
  const inputs = workloads
    .map(parseBenchmarkAmount)
    .filter((input): input is { amount: number; unit: string } => input !== undefined)
    .sort((left, right) => left.amount - right.amount);
  if (inputs.length < 2) {
    return AUTO_WORKLOAD;
  }
  const first = inputs[0];
  const last = inputs[inputs.length - 1];
  return `${AUTO_WORKLOAD} (${formatInputValue(first.amount, first.unit)} - ${formatInputValue(last.amount, last.unit)})`;
}

function sortWorkloads(workloads: string[]) {
  return [...workloads].sort((left, right) => {
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

function sortBenchmarkNames(benchmarkNames: string[]) {
  return [...benchmarkNames].sort((left, right) => {
    const leftLabel = labelize(left);
    const rightLabel = labelize(right);
    return leftLabel.localeCompare(rightLabel);
  });
}

function representativeWorkloadFor(rows: Array<Pick<BenchmarkResult, "workload" | "inputAmount">>) {
  const byWorkload = new Map<string, number>();
  for (const row of rows) {
    const amount = row.inputAmount ?? parseBenchmarkAmount(row.workload)?.amount;
    if (amount) {
      byWorkload.set(row.workload, amount);
    }
  }
  const candidates = [...byWorkload.entries()].sort((left, right) => left[1] - right[1]);
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
  return selectedAlgorithms.filter((algorithm) => matchingAlgorithms.includes(algorithm));
}

function disambiguateHosts<T extends { readonly id: string; readonly label: string }>(
  hosts: readonly T[],
): T[] {
  const labelCounts = new Map<string, number>();
  for (const host of hosts) {
    labelCounts.set(host.label, (labelCounts.get(host.label) ?? 0) + 1);
  }
  return hosts.map((host) => {
    if ((labelCounts.get(host.label) ?? 0) <= 1) {
      return host;
    }
    return {
      ...host,
      label: `${host.label} · ${host.id}`,
    };
  });
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
