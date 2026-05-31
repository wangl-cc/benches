import {
  clearPublishLogin,
  importPublishCredentials,
  readPublishLoginStatus,
} from "./credentials.ts";

type ImportArgs = {
  readonly accessClientId: string;
  readonly apiUrl?: string;
};

export async function main(argv: readonly string[]): Promise<void> {
  const command = argv[2];
  if (command === "import") {
    const status = await importPublishCredentials(parseImportArgs(argv.slice(3)), process.env);
    console.log(`Stored encrypted publish credentials for ${status.apiUrl}`);
    console.log(`Credential file: ${status.encryptedFile}`);
    return;
  }
  if (command === "status") {
    const status = await readPublishLoginStatus(process.env);
    console.log(`API URL: ${status.apiUrl}`);
    console.log(`Access Client ID: ${status.accessClientId ?? "not configured"}`);
    console.log(`Credential file: ${status.encryptedFile}`);
    return;
  }
  if (command === "logout") {
    await clearPublishLogin();
    console.log("Cleared local publish credentials.");
    return;
  }

  throw new Error(
    "usage: bench-auth.ts <import --access-client-id <id> [--api-url <url>] | status | logout>",
  );
}

function parseImportArgs(args: readonly string[]): ImportArgs {
  let accessClientId: string | undefined;
  let apiUrl: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--access-client-id") {
      accessClientId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--api-url") {
      apiUrl = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!accessClientId) {
    throw new Error("import requires --access-client-id");
  }
  return { accessClientId, apiUrl };
}

if (process.argv[1]?.endsWith("/bench-auth.ts")) {
  main(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
