import { spawnSync } from "node:child_process";

export type BenchScope = "hash" | "prng" | "all";

type ParsedBenchArgs = {
  readonly scope: BenchScope;
  readonly cargoArgs: readonly string[];
  readonly explicitOut?: string;
};

const targets = {
  hash: { packageName: "bench_hash", benchName: "hash", output: "../target/bench-runs/hash/latest.json" },
  prng: { packageName: "bench_prng", benchName: "prng", output: "../target/bench-runs/prng/latest.json" },
} as const;

export function parseBenchArgs(argv: readonly string[]): ParsedBenchArgs {
  const args = [...argv];
  if (args[0] === "--") {
    args.shift();
  }

  let scope: BenchScope = "all";
  let explicitOut: string | undefined;
  const cargoArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--scope") {
      const value = args[index + 1];
      if (!isBenchScope(value)) {
        throw new Error("--scope must be hash, prng, or all");
      }
      scope = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      const value = arg.slice("--scope=".length);
      if (!isBenchScope(value)) {
        throw new Error("--scope must be hash, prng, or all");
      }
      scope = value;
      continue;
    }
    if (arg === "--out") {
      explicitOut = args[index + 1];
      cargoArgs.push(arg);
      if (explicitOut !== undefined) {
        cargoArgs.push(explicitOut);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--out=")) {
      explicitOut = arg.slice("--out=".length);
      cargoArgs.push(arg);
      continue;
    }
    cargoArgs.push(arg);
  }

  if (scope === "all" && explicitOut) {
    throw new Error("--out cannot be used with --scope all because all writes one run per scope");
  }

  return { scope, cargoArgs, explicitOut };
}

export function scopesFor(scope: BenchScope): Array<"hash" | "prng"> {
  return scope === "all" ? ["hash", "prng"] : [scope];
}

export function defaultOutputFor(scope: "hash" | "prng"): string {
  return targets[scope].output;
}

export function runBench(argv: readonly string[]): void {
  const parsed = parseBenchArgs(argv);
  for (const scope of scopesFor(parsed.scope)) {
    const target = targets[scope];
    const result = spawnSync(
      "cargo",
      [
        "bench",
        "--manifest-path",
        "../Cargo.toml",
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
      throw new Error(`${target.packageName} benchmark failed with exit code ${result.status ?? 1}`);
    }
  }
}

function isBenchScope(value: string | undefined): value is BenchScope {
  return value === "hash" || value === "prng" || value === "all";
}

if (process.argv[1]?.endsWith("/bench-run.ts")) {
  try {
    runBench(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
