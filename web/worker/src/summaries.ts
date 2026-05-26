import {
  type BenchRun,
  type JsonObject,
  isObject,
  numberField,
  stringField,
} from "../../packages/bench-schema/src/index.ts";
import type { DerivedSummaryPlan } from "./types.ts";

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

type GroupDefinition = {
  readonly description: string | null;
  readonly workloadName: string | null;
  readonly workloadUnit: string;
  readonly cases: ReadonlyMap<string, JsonObject>;
};

export function deriveSummaries(run: BenchRun): DerivedSummaryPlan {
  const issues: string[] = [];
  const definitions = groupDefinitions(run);
  const summaries: JsonObject[] = [];

  for (const [index, measurement] of run.measurements.entries()) {
    if (!isObject(measurement)) {
      issues.push(`measurements[${index}] is not an object`);
      continue;
    }

    const groupName = stringField(measurement, "group");
    const caseName = stringField(measurement, "case");
    const workloadSize = numberField(measurement, "workloadSize");
    const definition = groupName ? definitions.get(groupName) : undefined;
    const benchCase = caseName ? definition?.cases.get(caseName) : undefined;
    const samples = sampleMeasurements(measurement);
    if (!groupName || !caseName || !definition || !benchCase || !workloadSize) {
      issues.push(`measurements[${index}] references an unknown group, case, or workload size`);
      continue;
    }
    if (samples.length === 0) {
      issues.push(`measurements[${index}] has no samples`);
      continue;
    }

    const inputUnit = definition.workloadUnit;
    const sampleWindowNs = samples.map((sample) => sample.elapsedNs);
    const latencyNsPerIteration = samples.map(
      (sample) => sample.elapsedNs / sample.iterations,
    );
    const windowStats = statsFrom(sampleWindowNs);
    const latencyStats = statsFrom(latencyNsPerIteration);
    if (!windowStats || !latencyStats) {
      issues.push(`measurements[${index}] has no usable samples`);
      continue;
    }

    const throughputValue = workloadSize * 1_000_000_000 / latencyStats.median;
    const relativeStddev = latencyStats.mean > 0 ? latencyStats.stddev / latencyStats.mean : 0;
    const flags = stabilityFlags(run, samples, latencyStats, relativeStddev);
    const totalIterations = samples.reduce((total, sample) => total + sample.iterations, 0);
    const representativeIterations = representativeIterationCount(samples);

    summaries.push({
      schemaVersion: "bench.summary.v1",
      benchmarkName: benchmarkName(run),
      caseId: measurementCaseId(groupName, caseName, workloadSize),
      group: groupName,
      workloadDescription: definition.description,
      workload: benchmarkLabel(workloadSize, inputUnit),
      algorithm: caseName,
      algorithmColor: stringField(benchCase, "color") ?? null,
      input: {
        kind: definition.workloadName,
        amount: workloadSize,
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

export function rawCaseCount(run: BenchRun): number {
  return run.groups.reduce((total, group) => {
    const cases = Array.isArray(group.cases) ? group.cases.length : 0;
    return total + cases;
  }, 0);
}

export function runCaseEntries(run: BenchRun): readonly JsonObject[] {
  const definitions = groupDefinitions(run);
  return run.measurements.flatMap((measurement, index) => {
    if (!isObject(measurement)) {
      return [];
    }
    const groupName = stringField(measurement, "group");
    const caseName = stringField(measurement, "case");
    const workloadSize = numberField(measurement, "workloadSize");
    if (!groupName || !caseName || !workloadSize) {
      return [];
    }
    const definition = definitions.get(groupName);
    const benchCase = definition?.cases.get(caseName);
    if (!definition || !benchCase) {
      return [];
    }
    return [{
      id: measurementCaseId(groupName, caseName, workloadSize),
      benchmarkName: benchmarkName(run),
      group: groupName,
      name: caseName,
      algorithm: caseName,
      algorithmColor: stringField(benchCase, "color") ?? null,
      workloadDescription: definition.description,
      input: {
        kind: definition.workloadName,
        amount: workloadSize,
        unit: definition.workloadUnit,
      },
      measurementIndex: index,
    }];
  });
}

export function benchmarkName(run: BenchRun): string {
  const firstGroup = run.groups.find((group) => isObject(group));
  return firstGroup ? stringField(firstGroup, "name") ?? "unknown" : "unknown";
}

export function isQuickRun(run: BenchRun): boolean {
  return stringField(run.harness, "profile") === "quick";
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
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right);
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
  if (isQuickRun(run)) {
    flags.push("quick_mode");
  }
  if (hasVaryingIterations(samples)) {
    flags.push("varying_iterations");
  }
  return flags;
}

function groupDefinitions(run: BenchRun): ReadonlyMap<string, GroupDefinition> {
  const definitions = new Map<string, GroupDefinition>();
  for (const group of run.groups) {
    const name = stringField(group, "name");
    if (!name) {
      continue;
    }
    const workload = isObject(group.workload) ? group.workload : {};
    const cases = new Map<string, JsonObject>();
    if (Array.isArray(group.cases)) {
      for (const benchCase of group.cases) {
        if (!isObject(benchCase)) {
          continue;
        }
        const caseName = stringField(benchCase, "name");
        if (caseName) {
          cases.set(caseName, benchCase);
        }
      }
    }
    definitions.set(name, {
      description: stringField(group, "description") ?? null,
      workloadName: stringField(workload, "name") ?? null,
      workloadUnit: stringField(workload, "unit") ?? "operation",
      cases,
    });
  }
  return definitions;
}

function sampleMeasurements(measurement: JsonObject): SampleMeasurement[] {
  if (!Array.isArray(measurement.samples)) {
    return [];
  }
  return measurement.samples.flatMap((sample) => {
    if (!isObject(sample)) {
      return [];
    }
    const iterations = numberField(sample, "iterations");
    const elapsedNs = numberField(sample, "elapsedNs");
    if (!iterations || !elapsedNs || iterations <= 0 || elapsedNs <= 0) {
      return [];
    }
    return [{ iterations, elapsedNs }];
  });
}

function measurementCaseId(group: string, benchCase: string, workloadSize: number): string {
  return `${group}/${benchCase}/${formatInputAmount(workloadSize)}`;
}

function benchmarkLabel(inputAmount: number, inputUnit: string): string {
  return `${formatInputAmount(inputAmount)} ${shortInputUnit(inputUnit)}`;
}

function formatInputAmount(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(4)));
}

function shortInputUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  if (normalized === "bytes") {
    return "B";
  }
  if (normalized === "elements" || normalized === "items") {
    return "elem";
  }
  return unit;
}

function perSecondUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  if (normalized === "bytes") {
    return "bytes/s";
  }
  if (normalized === "elements" || normalized === "items") {
    return "elem/s";
  }
  return `${unit}/s`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function outlierTotal(outliers: OutlierCounts): number {
  return outliers.lowMild + outliers.highMild + outliers.lowSevere + outliers.highSevere;
}

function representativeIterationCount(samples: readonly SampleMeasurement[]): number {
  if (!hasVaryingIterations(samples)) {
    return samples[0]?.iterations ?? 0;
  }
  return Math.round(percentileSorted(
    samples.map((sample) => sample.iterations).sort((left, right) => left - right),
    0.5,
  ));
}

function hasVaryingIterations(samples: readonly SampleMeasurement[]): boolean {
  const first = samples[0]?.iterations;
  return first !== undefined && samples.some((sample) => sample.iterations !== first);
}
