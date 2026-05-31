import {
  type BenchRun,
  canonicalJson,
  type JsonObject,
  parseBenchRunJson,
  validationMessage,
} from "../packages/bench-schema/src/index.ts";
import { hashRun, publishRun } from "./publish.ts";

type SeedHost = {
  readonly id: string;
  readonly cpu: string;
  readonly os: string;
  readonly kernel: string;
  readonly factor: number;
};

type SeedGroup = {
  readonly groupName: string;
  readonly algorithms: readonly AlgorithmProfile[];
};

type AlgorithmProfile = {
  readonly name: string;
  readonly color: string;
  readonly factor: number;
  readonly rsd: number;
};

const sizes = [16, 32, 64, 128, 256, 512, 1024, 4096, 65_536] as const;

const hosts: readonly SeedHost[] = [
  {
    id: "apple-m1",
    cpu: "Apple M1",
    os: "macos",
    kernel: "Darwin 25.5.0",
    factor: 0.62,
  },
  {
    id: "ryzen-9-9950x",
    cpu: "AMD Ryzen 9 9950X",
    os: "linux",
    kernel: "Linux 6.14.4",
    factor: 1,
  },
  {
    id: "m3-max",
    cpu: "Apple M3 Max",
    os: "macos",
    kernel: "Darwin 25.5.0",
    factor: 0.92,
  },
];

const groups: readonly SeedGroup[] = [
  {
    groupName: "Cryptographic Hash",
    algorithms: [
      { name: "BLAKE3-256", color: "#0f766e", factor: 1, rsd: 0.008 },
      { name: "BLAKE2B-512", color: "#14b8a6", factor: 0.42, rsd: 0.011 },
      { name: "SHA2-256", color: "#ea580c", factor: 0.28, rsd: 0.014 },
      { name: "SHA2-512", color: "#f59e0b", factor: 0.18, rsd: 0.018 },
    ],
  },
  {
    groupName: "Non-cryptographic Hash",
    algorithms: [
      { name: "XXH3-64", color: "#0891b2", factor: 1.55, rsd: 0.007 },
      { name: "AHash", color: "#db2777", factor: 1.4, rsd: 0.009 },
      { name: "FxHash", color: "#7c3aed", factor: 1.2, rsd: 0.01 },
      { name: "SipHash-1-3", color: "#64748b", factor: 0.32, rsd: 0.016 },
    ],
  },
  {
    groupName: "PRNG Bytes Generation",
    algorithms: [
      { name: "Xoshiro256++", color: "#be123c", factor: 1.55, rsd: 0.009 },
      { name: "SmallRng", color: "#3b82f6", factor: 1.35, rsd: 0.01 },
      { name: "ChaCha8Rng", color: "#7c3aed", factor: 0.9, rsd: 0.012 },
      { name: "StdRng", color: "#475569", factor: 0.78, rsd: 0.015 },
    ],
  },
  {
    groupName: "PRNG u64 Generation",
    algorithms: [
      { name: "Xoshiro256++", color: "#be123c", factor: 1.3, rsd: 0.008 },
      { name: "SmallRng", color: "#3b82f6", factor: 1.18, rsd: 0.01 },
      { name: "ChaCha8Rng", color: "#7c3aed", factor: 0.82, rsd: 0.012 },
      { name: "StdRng", color: "#475569", factor: 0.7, rsd: 0.015 },
    ],
  },
];

async function main(): Promise<void> {
  const config = readSeedConfig();
  const runs = hosts.flatMap((host) => groups.map((group) => buildRun(host, group)));
  for (const run of runs) {
    validateSeedRun(run);
    const contentHash = await hashRun(run);
    const response = await publishRun(config, run, contentHash);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`seed ${run.runId} failed with HTTP ${response.status}\n${response.body}`);
    }
    console.log(`${run.runId}: ${response.body}`);
  }
}

function buildRun(host: SeedHost, group: SeedGroup): BenchRun {
  const measurements: JsonObject[] = [];

  for (const algorithm of group.algorithms) {
    for (const size of sizes) {
      const throughput = throughputValue(host, group, algorithm, size);
      const relativeStdDev = relativeStdDevValue(host, algorithm, size);
      measurements.push({
        group: group.groupName,
        case: algorithm.name,
        workloadSize: size,
        samples: sampleRows(size, throughput, relativeStdDev),
      });
    }
  }

  return {
    schemaVersion: "bench.run.v3",
    runId: `seed-20260526-v4-host-label-${slugify(group.groupName)}-${host.id}`,
    createdAt: createdAtForHost(host),
    git: {
      commit: "seeded-fixture",
      branch: "benchmark-explorer-seed",
      dirty: false,
    },
    host: {
      id: host.id,
      cpu: host.cpu,
      os: host.os,
      kernel: host.kernel,
      arch: host.os === "linux" ? "x86_64" : "aarch64",
      rustc: "rustc 1.95.0 (seeded 2026-05-23)",
      llvm: "21.0",
    },
    harness: {
      name: "harness",
      version: "seed-fixture-v1",
      profile: "publish",
      sampleCount: 50,
      warmupMs: 1,
      calibrationMinMs: 1,
      targetSampleMs: 1,
      build: { rustflags: ["-Ctarget-cpu=native"] },
    },
    groups: [{
      name: group.groupName,
      description: workloadDescription(group.groupName),
      workload: workloadAxis(group.groupName),
      sizes: [...sizes],
      cases: group.algorithms.map((algorithm) => ({
        name: algorithm.name,
        color: algorithm.color,
      })),
    }],
    measurements,
  };
}

function sampleRows(
  inputAmount: number,
  throughput: number,
  relativeStdDev: number,
): JsonObject[] {
  const iterations = Math.max(1_000, Math.floor(20_000_000 / Math.max(inputAmount, 1)));
  return Array.from({ length: 50 }, (_, index) => {
    const wave = Math.sin((index + 1) * 1.7) * relativeStdDev;
    const adjustedThroughput = throughput * (1 + wave);
    const elapsedNs = Math.max(
      1,
      Math.round((inputAmount * iterations * 1_000_000_000) / adjustedThroughput),
    );
    return {
      iterations,
      elapsedNs,
    };
  });
}

function validateSeedRun(run: BenchRun): void {
  const parsed = parseBenchRunJson(canonicalJson(run));
  if (!parsed.ok) {
    throw new Error(`invalid seed run ${run.runId}\n${validationMessage(parsed.issues)}`);
  }
}

function throughputValue(
  host: SeedHost,
  group: SeedGroup,
  algorithm: AlgorithmProfile,
  size: number,
): number {
  const sizeProgress = Math.log2(size + 16) / Math.log2(65_536 + 16);
  const groupFactor = group.groupName === "PRNG u64 Generation" ? 0.75 : group.groupName === "PRNG Bytes Generation" ? 0.95 : 1;
  const cacheKnee = size >= 4096 ? 0.92 : 1;
  return 120_000_000 * host.factor * algorithm.factor * groupFactor * cacheKnee * (1 + sizeProgress * 132);
}

function relativeStdDevValue(host: SeedHost, algorithm: AlgorithmProfile, size: number): number {
  const largeInputPenalty = size >= 32_768 ? 0.008 : 0;
  const hostPenalty = host.id === "apple-m1" ? 0.001 : 0;
  const algorithmPenalty = algorithm.name === "SHA2-512" || algorithm.name === "StdRng" ? largeInputPenalty : 0;
  return Number((algorithm.rsd + hostPenalty + algorithmPenalty).toFixed(4));
}

function workloadDescription(group: string): string {
  if (group === "Cryptographic Hash") {
    return "Hashes deterministic byte buffers with cryptographic hash functions.";
  }
  if (group === "Non-cryptographic Hash") {
    return "Hashes deterministic byte buffers with non-cryptographic hash functions.";
  }
  if (group === "PRNG u64 Generation") {
    return "Generates fixed-size batches of u64 values from each PRNG implementation.";
  }
  return "Fills fixed-size byte buffers from each PRNG implementation.";
}

function workloadAxis(groupName: string): { readonly name: string; readonly unit: string } {
  if (groupName === "PRNG u64 Generation") {
    return { name: "Batch length", unit: "elements" };
  }
  if (groupName === "PRNG Bytes Generation") {
    return { name: "Buffer size", unit: "bytes" };
  }
  return { name: "Message size", unit: "bytes" };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readSeedConfig() {
  return {
    apiUrl: "http://localhost:8787",
    clientId: "local-bench-seed",
    clientSecret: "local-bench-secret",
  };
}

function createdAtForHost(host: SeedHost): string {
  const offsetMinutes = hosts.findIndex((entry) => entry.id === host.id) * 11;
  return new Date(Date.UTC(2026, 4, 23, 10, offsetMinutes, 0)).toISOString();
}

if (process.argv[1]?.endsWith("/seed-runs.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
