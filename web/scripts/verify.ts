import { fileURLToPath } from "node:url";

import { runCommand, stripLeadingSeparator } from "./command.ts";

type VerifyMode = "rust" | "web" | "deploy";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const apiTsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const siteRoot = fileURLToPath(new URL("../site", import.meta.url));
const siteTsc = fileURLToPath(
  new URL("../site/node_modules/.bin/tsc", import.meta.url),
);
const vite = fileURLToPath(
  new URL("../site/node_modules/.bin/vite", import.meta.url),
);

function parseVerifyArgs(argv: readonly string[]): {
  readonly modes: readonly VerifyMode[];
  readonly runQuickBench: boolean;
} {
  const modes = new Set<VerifyMode>();
  let runQuickBench = false;

  for (const arg of stripLeadingSeparator(argv)) {
    if (arg === "--rust") {
      modes.add("rust");
      continue;
    }
    if (arg === "--web") {
      modes.add("web");
      continue;
    }
    if (arg === "--deploy") {
      modes.add("deploy");
      continue;
    }
    if (arg === "--all") {
      modes.add("rust");
      modes.add("web");
      modes.add("deploy");
      runQuickBench = true;
      continue;
    }
    throw new Error(`unknown verify option: ${arg}`);
  }

  if (modes.size === 0) {
    modes.add("rust");
    modes.add("web");
  }

  return { modes: [...modes], runQuickBench };
}

function verify(argv: readonly string[]): void {
  const args = parseVerifyArgs(argv);

  for (const mode of args.modes) {
    if (mode === "rust") {
      runCommand("cargo", ["check", "--workspace"], { cwd: repoRoot });
      runCommand("cargo", ["test", "-p", "harness"], { cwd: repoRoot });
      runCommand("cargo", ["clippy", "--workspace"], { cwd: repoRoot });
      continue;
    }

    if (mode === "web") {
      runCommand(apiTsc, ["-p", "tsconfig.bench-api.json"], { cwd: webRoot });
      runCommand(
        "node",
        ["--experimental-strip-types", "--test", "scripts/publish.test.ts"],
        { cwd: webRoot },
      );
      runCommand(siteTsc, ["--noEmit"], { cwd: siteRoot });
      runCommand(vite, ["build"], { cwd: siteRoot });
      continue;
    }

    runCommand(
      "node",
      ["--experimental-strip-types", "scripts/deploy.ts", "--dry-run"],
      { cwd: webRoot },
    );
    runCommand(
      "node",
      [
        "--experimental-strip-types",
        "scripts/deploy.ts",
        "--preview",
        "--dry-run",
      ],
      { cwd: webRoot },
    );
  }

  if (args.runQuickBench) {
    runCommand(
      "node",
      ["--experimental-strip-types", "scripts/bench-run.ts", "--profile", "quick"],
      { cwd: webRoot },
    );
  }
}

if (process.argv[1]?.endsWith("/verify.ts")) {
  try {
    verify(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
