import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BenchTargetSet = "hash" | "prng" | "all" | BenchTargetName;

type ParsedBenchArgs = {
  readonly targetSet: BenchTargetSet;
  readonly cargoArgs: readonly string[];
  readonly explicitOut?: string;
};

const targets = {
  non_cryptographic_hash: {
    packageName: "bench_hash",
    benchName: "non_cryptographic_hash",
    output: "../target/bench-runs/non-cryptographic-hash/latest.json",
  },
  cryptographic_hash: {
    packageName: "bench_hash",
    benchName: "cryptographic_hash",
    output: "../target/bench-runs/cryptographic-hash/latest.json",
  },
  u64_generation: {
    packageName: "bench_prng",
    benchName: "u64_generation",
    output: "../target/bench-runs/prng-u64-generation/latest.json",
  },
  bytes_generation: {
    packageName: "bench_prng",
    benchName: "bytes_generation",
    output: "../target/bench-runs/prng-bytes-generation/latest.json",
  },
} as const satisfies Record<string, BenchTarget>;

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

type BenchTargetName = keyof typeof targets;

type BenchTarget = {
  readonly packageName: string;
  readonly benchName: string;
  readonly output: string;
};

export function parseBenchArgs(argv: readonly string[]): ParsedBenchArgs {
  const args = [...argv];
  if (args[0] === "--") {
    args.shift();
  }

  let targetSet: BenchTargetSet = "all";
  let explicitOut: string | undefined;
  const cargoArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      const value = args[index + 1];
      if (!isBenchTargetSet(value)) {
        throw new Error("--target must be all, hash, prng, or a bench target name");
      }
      targetSet = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length);
      if (!isBenchTargetSet(value)) {
        throw new Error("--target must be all, hash, prng, or a bench target name");
      }
      targetSet = value;
      continue;
    }
    if (arg === "--out") {
      const value = args[index + 1];
      cargoArgs.push(arg);
      if (value !== undefined) {
        explicitOut = resolve(value);
        cargoArgs.push(explicitOut);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--out=")) {
      explicitOut = resolve(arg.slice("--out=".length));
      cargoArgs.push(`--out=${explicitOut}`);
      continue;
    }
    cargoArgs.push(arg);
  }

  if (targetsFor(targetSet).length > 1 && explicitOut) {
    throw new Error(
      "--out can only be used when --target selects one bench target",
    );
  }

  return { targetSet, cargoArgs, explicitOut };
}

export function targetsFor(targetSet: BenchTargetSet): BenchTargetName[] {
  if (targetSet === "all") {
    return [
      "non_cryptographic_hash",
      "cryptographic_hash",
      "u64_generation",
      "bytes_generation",
    ];
  }
  if (targetSet === "hash") {
    return ["non_cryptographic_hash", "cryptographic_hash"];
  }
  if (targetSet === "prng") {
    return ["u64_generation", "bytes_generation"];
  }
  return [targetSet];
}

export function defaultOutputFor(targetName: BenchTargetName): string {
  return targets[targetName].output;
}

export function runBench(argv: readonly string[]): void {
  const parsed = parseBenchArgs(argv);
  const originalCwd = process.cwd();
  process.chdir(repoRoot);
  try {
    for (const targetName of targetsFor(parsed.targetSet)) {
      const target = targets[targetName];
      const result = spawnSync(
        "cargo",
        [
          "bench",
          "-p",
          target.packageName,
          "--bench",
          target.benchName,
          "--",
          ...parsed.cargoArgs,
        ],
        { stdio: "inherit" },
      );

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(
          `${target.packageName} benchmark failed with exit code ${result.status ?? 1}`,
        );
      }
    }
  } finally {
    process.chdir(originalCwd);
  }
}

function isBenchTargetSet(value: string | undefined): value is BenchTargetSet {
  return value === "hash" || value === "prng" || value === "all" || isBenchTargetName(value);
}

function isBenchTargetName(value: string | undefined): value is BenchTargetName {
  return value !== undefined && value in targets;
}

if (process.argv[1]?.endsWith("/bench-run.ts")) {
  try {
    runBench(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
