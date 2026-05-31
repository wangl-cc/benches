import { fileURLToPath } from "node:url";

import { runCommand, stripLeadingSeparator } from "./command.ts";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);
const wranglerEnv = {
  ...process.env,
  XDG_CONFIG_HOME: fileURLToPath(new URL("../.wrangler/config", import.meta.url)),
};

function parseMigrateArgs(argv: readonly string[]): readonly string[] {
  const args = stripLeadingSeparator(argv);
  for (const arg of args) {
    if (arg !== "--local" && arg !== "--remote") {
      throw new Error(`unknown migrate option: ${arg}`);
    }
  }
  return args;
}

function migrate(argv: readonly string[]): void {
  runCommand(
    wrangler,
    [
      "d1",
      "migrations",
      "apply",
      "BENCH_DB",
      "--config",
      "wrangler.jsonc",
      ...parseMigrateArgs(argv),
    ],
    { cwd: webRoot, env: wranglerEnv },
  );
}

if (process.argv[1]?.endsWith("/migrate.ts")) {
  try {
    migrate(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
