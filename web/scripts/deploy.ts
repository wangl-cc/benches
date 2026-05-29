import { fileURLToPath } from "node:url";

import { runCommand, stripLeadingSeparator } from "./command.ts";

type DeployArgs = {
  readonly preview: boolean;
  readonly dryRun: boolean;
};

const siteRoot = fileURLToPath(new URL("../site", import.meta.url));
const siteTsc = fileURLToPath(
  new URL("../site/node_modules/.bin/tsc", import.meta.url),
);
const vite = fileURLToPath(
  new URL("../site/node_modules/.bin/vite", import.meta.url),
);
const workerRoot = fileURLToPath(new URL("../worker", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../worker/node_modules/.bin/wrangler", import.meta.url),
);
const wranglerEnv = {
  ...process.env,
  XDG_CONFIG_HOME: fileURLToPath(new URL("../.wrangler/config", import.meta.url)),
};

function parseDeployArgs(argv: readonly string[]): DeployArgs {
  let preview = false;
  let dryRun = false;

  for (const arg of stripLeadingSeparator(argv)) {
    if (arg === "--preview") {
      preview = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`unknown deploy option: ${arg}`);
  }

  return { preview, dryRun };
}

function deploy(argv: readonly string[]): void {
  const args = parseDeployArgs(argv);

  runCommand(siteTsc, ["--noEmit"], { cwd: siteRoot });
  runCommand(vite, ["build"], { cwd: siteRoot });

  if (!args.preview && !args.dryRun) {
    runCommand(
      wrangler,
      [
        "d1",
        "migrations",
        "apply",
        "BENCH_DB",
        "--config",
        "../wrangler.jsonc",
        "--remote",
      ],
      { cwd: workerRoot, env: wranglerEnv },
    );
  }

  const wranglerArgs = [
    "deploy",
    "--config",
    "../wrangler.jsonc",
  ];
  if (args.preview) {
    wranglerArgs.push("--env", "preview");
  } else {
    wranglerArgs.push("--env", "");
  }
  if (args.dryRun) {
    wranglerArgs.push("--dry-run");
  }

  runCommand(wrangler, wranglerArgs, { cwd: workerRoot, env: wranglerEnv });
}

if (process.argv[1]?.endsWith("/deploy.ts")) {
  try {
    deploy(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
