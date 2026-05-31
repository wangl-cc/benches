import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  type BenchRun,
  canonicalJson,
  parseBenchRunJson,
  validationMessage,
} from "../packages/bench-schema/src/index.ts";
import { loadPublishCredentials } from "./credentials.ts";

type PublishConfig = {
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

type PublishResponse = {
  readonly status: number;
  readonly body: string;
};

export async function main(argv: readonly string[]): Promise<void> {
  const path = argv[2];
  if (!path) {
    throw new Error("usage: publish.ts <path-to-run.json>");
  }

  const config = await loadPublishCredentials(process.env);
  const run = await readRun(path);
  const contentHash = await hashRun(run);
  const response = await publishRun(config, run, contentHash);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `publish failed with HTTP ${response.status}\n${response.body}`,
    );
  }

  console.log(response.body);
}

export async function readRun(path: string): Promise<BenchRun> {
  const text = await readFile(path, "utf8");
  const parsed = parseBenchRunJson(text);
  if (!parsed.ok) {
    throw new Error(`invalid run JSON\n${validationMessage(parsed.issues)}`);
  }
  return parsed.value;
}

export async function hashRun(run: BenchRun): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(run));
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function publishRun(
  config: PublishConfig,
  run: BenchRun,
  contentHash: string,
): Promise<PublishResponse> {
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}/api/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bench-content-sha256": contentHash,
      "cf-access-client-id": config.clientId,
      "cf-access-client-secret": config.clientSecret,
    },
    body: JSON.stringify(run),
  });

  return {
    status: response.status,
    body: await response.text(),
  };
}

if (process.argv[1]?.endsWith("/publish.ts")) {
  main(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
