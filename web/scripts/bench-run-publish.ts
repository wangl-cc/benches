import { defaultOutputFor, parseBenchArgs, runBench, targetsFor } from "./bench-run.ts";
import { main as publishMain } from "./publish.ts";

async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseBenchArgs(argv);
  runBench(argv);

  for (const targetName of targetsFor(parsed.targetSet)) {
    const path = parsed.explicitOut ?? defaultOutputFor(targetName);
    await publishMain(["node", "publish.ts", path]);
  }
}

if (process.argv[1]?.endsWith("/bench-run-publish.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
