import { type BenchRun, type JsonObject } from "../packages/bench-schema/src/index.ts";
import { hashRun, publishRun } from "./publish.ts";

type SeedHost = {
  readonly id: string;
  readonly label: string;
  readonly cpu: string;
  readonly os: string;
  readonly kernel: string;
  readonly factor: number;
};

type SeedGroup = {
  readonly scopeId: string;
  readonly scopeTitle: string;
  readonly group: string;
  readonly title: string;
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
    label: "Apple M1",
    cpu: "Apple M1",
    os: "macos",
    kernel: "Darwin 25.5.0",
    factor: 0.62,
  },
  {
    id: "ryzen-9-9950x",
    label: "Ryzen 9 9950X",
    cpu: "AMD Ryzen 9 9950X",
    os: "linux",
    kernel: "Linux 6.14.4",
    factor: 1,
  },
  {
    id: "m3-max",
    label: "M3 Max",
    cpu: "Apple M3 Max",
    os: "macos",
    kernel: "Darwin 25.5.0",
    factor: 0.92,
  },
];

const groups: readonly SeedGroup[] = [
  {
    scopeId: "hash",
    scopeTitle: "Hash",
    group: "cryptographic_hash",
    title: "Cryptographic Hash",
    algorithms: [
      { name: "BLAKE3-256", color: "#0f766e", factor: 1, rsd: 0.008 },
      { name: "BLAKE2B-512", color: "#14b8a6", factor: 0.42, rsd: 0.011 },
      { name: "SHA2-256", color: "#ea580c", factor: 0.28, rsd: 0.014 },
      { name: "SHA2-512", color: "#f59e0b", factor: 0.18, rsd: 0.018 },
    ],
  },
  {
    scopeId: "hash",
    scopeTitle: "Hash",
    group: "non_cryptographic_hash",
    title: "Non-cryptographic Hash",
    algorithms: [
      { name: "XXH3-64", color: "#0891b2", factor: 1.55, rsd: 0.007 },
      { name: "AHash", color: "#db2777", factor: 1.4, rsd: 0.009 },
      { name: "FxHash", color: "#7c3aed", factor: 1.2, rsd: 0.01 },
      { name: "SipHash-1-3", color: "#64748b", factor: 0.32, rsd: 0.016 },
    ],
  },
  {
    scopeId: "prng",
    scopeTitle: "Prng",
    group: "bytes_generation",
    title: "Bytes Generation",
    algorithms: [
      { name: "Xoshiro256++", color: "#be123c", factor: 1.55, rsd: 0.009 },
      { name: "SmallRng", color: "#3b82f6", factor: 1.35, rsd: 0.01 },
      { name: "ChaCha8Rng", color: "#7c3aed", factor: 0.9, rsd: 0.012 },
      { name: "StdRng", color: "#475569", factor: 0.78, rsd: 0.015 },
    ],
  },
  {
    scopeId: "prng",
    scopeTitle: "Prng",
    group: "u64_generation",
    title: "u64 Generation",
    algorithms: [
      { name: "Xoshiro256++", color: "#be123c", factor: 1.3, rsd: 0.008 },
      { name: "SmallRng", color: "#3b82f6", factor: 1.18, rsd: 0.01 },
      { name: "ChaCha8Rng", color: "#7c3aed", factor: 0.82, rsd: 0.012 },
      { name: "StdRng", color: "#475569", factor: 0.7, rsd: 0.015 },
    ],
  },
];

async function main(): Promise<void> {
  const config = readSeedConfig(process.env);
  const runs = hosts.map(buildRun);
  for (const run of runs) {
    const contentHash = await hashRun(run);
    const response = await publishRun(config, run, contentHash);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`seed ${run.runId} failed with HTTP ${response.status}\n${response.body}`);
    }
    console.log(`${run.runId}: ${response.body}`);
  }
}

function buildRun(host: SeedHost): BenchRun {
  const cases = new Map<string, JsonObject>();
  const samples: JsonObject[] = [];
  const warnings: string[] = [];

  for (const group of groups) {
    for (const algorithm of group.algorithms) {
      for (const size of sizes) {
        const caseId = `${group.scopeId}/${group.group}/${slugify(algorithm.name)}/${size}`;
        const benchmark = formatInputSize(size);
        const throughput = throughputValue(host, group, algorithm, size);
        const relativeStdDev = relativeStdDevValue(host, algorithm, size);
        const flags = stabilityFlags(relativeStdDev);
        if (flags.length > 0) {
          warnings.push(`${algorithm.name} ${benchmark}: ${flags.join(", ")}`);
        }

        cases.set(caseId, {
          id: caseId,
          scopeId: group.scopeId,
          group: group.group,
          name: benchmark,
          title: `${algorithm.name} ${benchmark}`,
          algorithm: algorithm.name,
          algorithmColor: algorithm.color,
          workloadDescription: workloadDescription(group.group),
          input: { kind: "bytes", amount: size, unit: "bytes" },
          seed: 0x4d53_4141_5f42_454e,
        });

        samples.push(...sampleRows(caseId, size, throughput, relativeStdDev));
      }
    }
  }

  return {
    schemaVersion: "bench.run.v2",
    runId: `seed-20260524-v2-tail-${host.id}`,
    createdAt: createdAtForHost(host),
    git: {
      commit: "seeded-fixture",
      branch: "benchmark-explorer-seed",
      dirty: false,
    },
    host: {
      id: host.id,
      label: host.label,
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
      mode: "publish",
      samples: 50,
      warmup: "synthetic",
    },
    scopes: uniqueScopes(),
    cases: [...cases.values()],
    samples,
    checksums: {
      mode: "seeded",
      deterministic: true,
    },
    warnings: unique(warnings),
  };
}

function sampleRows(
  caseId: string,
  inputAmount: number,
  throughput: number,
  relativeStdDev: number,
): JsonObject[] {
  const iterations = Math.max(1_000, Math.floor(20_000_000 / Math.max(inputAmount, 1)));
  return Array.from({ length: 50 }, (_, index) => {
    const wave = Math.sin((index + 1) * 1.7) * relativeStdDev;
    const adjustedThroughput = throughput * (1 + wave);
    const elapsedNs = (inputAmount * iterations * 1_000_000_000) / adjustedThroughput;
    return {
      caseId,
      sampleIndex: index,
      iterations,
      elapsedNs,
      checksum: "seeded",
    };
  });
}

function throughputValue(
  host: SeedHost,
  group: SeedGroup,
  algorithm: AlgorithmProfile,
  size: number,
): number {
  const sizeProgress = Math.log2(size + 16) / Math.log2(65_536 + 16);
  const groupFactor = group.group.includes("u64") ? 0.75 : group.group.includes("bytes") ? 0.95 : 1;
  const cacheKnee = size >= 4096 ? 0.92 : 1;
  return 120_000_000 * host.factor * algorithm.factor * groupFactor * cacheKnee * (1 + sizeProgress * 132);
}

function relativeStdDevValue(host: SeedHost, algorithm: AlgorithmProfile, size: number): number {
  const largeInputPenalty = size >= 32_768 ? 0.008 : 0;
  const hostPenalty = host.id === "apple-m1" ? 0.001 : 0;
  const algorithmPenalty = algorithm.name === "SHA2-512" || algorithm.name === "StdRng" ? largeInputPenalty : 0;
  return Number((algorithm.rsd + hostPenalty + algorithmPenalty).toFixed(4));
}

function stabilityFlags(relativeStdDev: number): readonly string[] {
  if (relativeStdDev > 0.025) {
    return ["high_rsd"];
  }
  if (relativeStdDev > 0.02) {
    return ["moderate_rsd"];
  }
  return [];
}

function workloadDescription(group: string): string {
  if (group === "cryptographic_hash") {
    return "Hashes deterministic byte buffers with cryptographic hash functions.";
  }
  if (group === "non_cryptographic_hash") {
    return "Hashes deterministic byte buffers with non-cryptographic hash functions.";
  }
  if (group === "u64_generation") {
    return "Generates fixed-size batches of u64 values from each PRNG implementation.";
  }
  return "Fills fixed-size byte buffers from each PRNG implementation.";
}

function uniqueScopes(): JsonObject[] {
  return unique(groups.map((group) => group.scopeId)).map((scopeId) => {
    const group = groups.find((entry) => entry.scopeId === scopeId);
    return { id: scopeId, title: group?.scopeTitle ?? scopeId };
  });
}

function readSeedConfig(env: Record<string, string | undefined>) {
  const apiUrl = env.BENCH_API_URL ?? "http://127.0.0.1:8788";
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/u.test(apiUrl);
  const clientId = env.CF_ACCESS_CLIENT_ID ?? (isLocal ? "local-bench-seed" : undefined);
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET ?? (isLocal ? "local-bench-secret" : undefined);
  if (!clientId || !clientSecret) {
    throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required outside local seed mode");
  }
  return { apiUrl, clientId, clientSecret };
}

function createdAtForHost(host: SeedHost): string {
  const offsetMinutes = hosts.findIndex((entry) => entry.id === host.id) * 11;
  return new Date(Date.UTC(2026, 4, 23, 10, offsetMinutes, 0)).toISOString();
}

function formatInputSize(size: number): string {
  if (size >= 1024) {
    return `${size / 1024} KiB`;
  }
  return `${size} B`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

if (process.argv[1]?.endsWith("/seed-runs.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
