import { defaultOutputFor, parseBenchArgs, runBench, targetsFor } from "./bench-run.ts";
import { hashRun, publishRun, readRun } from "./publish.ts";

const defaultArgs = ["--target", "all", "--profile", "quick"] as const;
const localConfig = {
  apiUrl: "http://localhost:8787",
  clientId: "local-bench-seed",
  clientSecret: "local-bench-secret",
};

async function main(argv: readonly string[]): Promise<void> {
  const args = withQuickDefault(argv.length === 0 ? defaultArgs : argv);
  const parsed = parseBenchArgs(args);
  runBench(args);

  for (const targetName of targetsFor(parsed.targetSet)) {
    const path = parsed.explicitOut ?? defaultOutputFor(targetName);
    const run = await readRun(path);
    const contentHash = await hashRun(run);
    const response = await publishRun(localConfig, run, contentHash);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`local publish failed for ${path} with HTTP ${response.status}\n${response.body}`);
    }
    console.log(`${path}: ${response.body}`);
  }
}

function withQuickDefault(argv: readonly string[]): readonly string[] {
  if (hasProfile(argv)) {
    return argv;
  }
  return [...argv, "--profile", "quick"];
}

function hasProfile(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--profile" || arg.startsWith("--profile="));
}

if (process.argv[1]?.endsWith("/smoke.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
