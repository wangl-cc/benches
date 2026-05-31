export type MetricDirection = "higher" | "lower";

export type BenchmarkEnvironment = {
  cpu: string;
  os: string;
  kernel?: string;
  rustc?: string;
  llvm?: string;
};

export type BenchmarkRun = {
  id: string;
  label: string;
  startedAt: string;
  benchmarkName?: string;
  host: {
    id: string;
    label: string;
    environment: BenchmarkEnvironment;
  };
};

export type BenchmarkResult = {
  id: string;
  runId: string;
  benchmarkName: string;
  group: string;
  workloadDescription?: string;
  workload: string;
  algorithm: string;
  algorithmColor?: string;
  metric: string;
  unit: string;
  value: number;
  direction: MetricDirection;
  inputAmount?: number;
  inputUnit?: string;
  samples?: number;
  relativeStdDev?: number;
  tailLatency?: {
    medianNsPerIter?: number;
    p90NsPerIter?: number;
    p95NsPerIter?: number;
    p99NsPerIter?: number;
  };
};

export type RunsResponse = { runs: unknown[] };
export type ResultsResponse = { results: unknown[] };

export type ExplorerData = {
  runs: BenchmarkRun[];
  results: BenchmarkResult[];
  source: "api" | "fixture";
};

export type AxisScale = "linear" | "log";
export type RankingGroup = "algorithm" | "platform";
export type TailLatencyMetric = "p50" | "p90" | "p95" | "p99";

export type HostOption = {
  id: string;
  label: string;
  cpu: string;
  environment: BenchmarkRun["host"]["environment"];
};

export type ResultRow = BenchmarkResult & {
  hostId: string;
  hostLabel: string;
  runLabel: string;
};

export type TrendSeries = {
  id: string;
  algorithm: string;
  hostId: string;
  platform: string;
  color: string;
  dash?: string;
  points: Array<{ x: number; y: number; label: string; unit?: string }>;
};

export type GroupedBarGroup = {
  id: string;
  label: string;
  rows: GroupedBarRow[];
};

export type GroupedBarRow = {
  id: string;
  sourceId: string;
  label: string;
  algorithm: string;
  hostId: string;
  platform: string;
  value: number;
  score: number;
  valueLabel: string;
  color: string;
  samples?: number;
  relativeStdDev?: number;
  detail: string;
};

export type TailLatencyRow = GroupedBarRow & {
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
};

export type ExplorerModelState = {
  benchmarkName: string;
  group: string;
  workload: string;
  query: string;
  platformIds: string[];
  algorithmIds: string[];
  rankingGroup: RankingGroup;
};

export type ExplorerModel = {
  hosts: HostOption[];
  selectedHostIds: string[];
  benchmarkNames: string[];
  groups: string[];
  workloadDescription?: string;
  workloads: string[];
  representativeWorkload: string;
  autoWorkload: string;
  availableAlgorithms: string[];
  visibleAlgorithms: string[];
  algorithmColors: Map<string, string>;
  selectedAlgorithms: string[];
  visibleRows: ResultRow[];
  trendSeries: TrendSeries[];
  rankingGroups: GroupedBarGroup[];
  unit: string;
};
