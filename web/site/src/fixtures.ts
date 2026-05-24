import { colorForAlgorithm } from "./colors";
import { formatInputSize } from "./format";
import type { BenchmarkResult, BenchmarkRun, ExplorerData } from "./types";
import { slugify } from "./utils";

type FixtureAlgorithm = {
  readonly name: string;
  readonly factor: number;
  readonly rsd: number;
};

export function fixtureData(): ExplorerData {
  const runs: BenchmarkRun[] = [
    fixtureRun("hash-m1-current", "Apple M1", "Apple M1", "macOS 15.5", "2026-05-19T11:24:00Z", ["hash"]),
    fixtureRun("hash-zen-current", "Ryzen 9 9950X", "AMD Ryzen 9 9950X", "Linux 6.14", "2026-05-19T11:42:00Z", ["hash"]),
    fixtureRun("hash-m3-current", "M3 Max", "Apple M3 Max", "macOS 15.5", "2026-05-19T12:05:00Z", ["hash"]),
    fixtureRun("prng-m1-current", "Apple M1", "Apple M1", "macOS 15.5", "2026-05-19T12:24:00Z", ["prng"]),
    fixtureRun("prng-m3-current", "M3 Max", "Apple M3 Max", "macOS 15.5", "2026-05-19T12:55:00Z", ["prng"]),
  ];
  const results: BenchmarkResult[] = [
    ...hashResults(runs.filter((run) => run.scopes?.includes("hash"))),
    ...prngResults(runs.filter((run) => run.scopes?.includes("prng"))),
  ];
  return { runs, results, source: "fixture" };
}

function hashResults(runs: BenchmarkRun[]): BenchmarkResult[] {
  return benchmarkResults({
    runs,
    scope: "hash",
    group: "cryptographic_hash",
    inputUnit: "bytes",
    unit: "bytes/s",
    workloadDescription: "Hashes deterministic byte buffers with cryptographic hash functions.",
    algorithms: [
      { name: "BLAKE3-256", factor: 1.0, rsd: 0.008 },
      { name: "SHA2-256", factor: 0.28, rsd: 0.014 },
      { name: "SHA2-512", factor: 0.18, rsd: 0.018 },
      { name: "BLAKE2B-512", factor: 0.42, rsd: 0.011 },
    ],
  });
}

function prngResults(runs: BenchmarkRun[]): BenchmarkResult[] {
  return benchmarkResults({
    runs,
    scope: "prng",
    group: "bytes_generation",
    inputUnit: "bytes",
    unit: "bytes/s",
    workloadDescription: "Fills fixed-size byte buffers from each PRNG implementation.",
    algorithms: [
      { name: "PCG64", factor: 0.84, rsd: 0.011 },
      { name: "PCG64-MCG", factor: 1.02, rsd: 0.009 },
      { name: "PCG64DXSM", factor: 0.78, rsd: 0.013 },
      { name: "xoshiro256++", factor: 1.24, rsd: 0.008 },
    ],
  });
}

function benchmarkResults({
  runs,
  scope,
  group,
  inputUnit,
  unit,
  workloadDescription,
  algorithms,
}: {
  runs: BenchmarkRun[];
  scope: string;
  group: string;
  inputUnit: string;
  unit: string;
  workloadDescription: string;
  algorithms: FixtureAlgorithm[];
}): BenchmarkResult[] {
  const sizes = [16, 64, 256, 1024, 4096, 65536];
  const platformFactor = new Map([
    ["hash-m1-current", 0.62],
    ["hash-zen-current", 1.0],
    ["hash-m3-current", 0.92],
    ["prng-m1-current", 0.68],
    ["prng-m3-current", 1.08],
  ]);
  const results: BenchmarkResult[] = [];
  for (const run of runs) {
    for (const algorithm of algorithms) {
      for (const size of sizes) {
        const ramp = Math.log2(size + 16) / Math.log2(65536 + 16);
        const value = 120_000_000 * (platformFactor.get(run.id) ?? 1) * algorithm.factor * (1 + ramp * 130);
        const medianNsPerIter = size * 1_000_000_000 / value;
        const elevatedRsd = size > 32768 && algorithm.name.includes("512");
        results.push({
          id: `${run.id}-${algorithm.name}-${size}`,
          runId: run.id,
          scope,
          group,
          workloadDescription,
          benchmark: `${formatInputSize(size)}`,
          algorithm: algorithm.name,
          algorithmColor: colorForAlgorithm(algorithm.name),
          metric: "throughput",
          unit,
          value,
          direction: "higher",
          inputAmount: size,
          inputUnit,
          samples: 50,
          relativeStdDev: algorithm.rsd + (elevatedRsd ? 0.018 : 0),
          tailLatency: {
            medianNsPerIter,
            p90NsPerIter: medianNsPerIter * (1 + algorithm.rsd * 1.35),
            p95NsPerIter: medianNsPerIter * (1 + algorithm.rsd * 1.75),
            p99NsPerIter: medianNsPerIter * (1 + algorithm.rsd * 2.45),
          },
          anomaly:
            elevatedRsd && run.host.label === "Apple M1"
              ? { level: "warning", message: "Elevated RSD at large input sizes." }
              : undefined,
        });
      }
    }
  }
  return results;
}

function fixtureRun(
  id: string,
  label: string,
  cpu: string,
  os: string,
  startedAt: string,
  scopes: string[],
): BenchmarkRun {
  return {
    id,
    label,
    startedAt,
    commit: "8fd3b1a",
    branch: "main",
    resultGroup: "nightly",
    scopes,
    host: {
      id: slugify(label),
      label,
      environment: {
        cpu,
        os,
        kernel: os.startsWith("Linux") ? "6.14.4" : "24.5.0",
        rustc: "1.89.0-nightly",
        llvm: "20.1",
      },
    },
  };
}
