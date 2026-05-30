import { isObject, stringField } from "../../packages/bench-schema/src/index.ts";
import type { Env } from "./types.ts";

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const tokens = parseUploadTokens(env);
  if (tokens.length === 0) {
    return false;
  }
  const clientId = request.headers.get("cf-access-client-id") ?? "";
  const clientSecret = request.headers.get("cf-access-client-secret") ?? "";
  let authorized = false;
  for (const token of tokens) {
    const [idMatches, secretMatches] = await Promise.all([
      timingSafeEqual(clientId, token.clientId),
      timingSafeEqual(clientSecret, token.clientSecret),
    ]);
    authorized = authorized || (idMatches && secretMatches);
  }
  return authorized;
}

export function parseUploadTokens(
  env: Pick<Env, "CF_ACCESS_TOKENS">,
): readonly { readonly clientId: string; readonly clientSecret: string }[] {
  if (!env.CF_ACCESS_TOKENS) {
    return [];
  }

  const value = JSON.parse(env.CF_ACCESS_TOKENS) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("CF_ACCESS_TOKENS must be a JSON array");
  }
  return value.map((item) => {
    if (!isObject(item)) {
      throw new Error("CF_ACCESS_TOKENS entries must be objects");
    }
    const clientId = stringField(item, "clientId");
    const clientSecret = stringField(item, "clientSecret");
    if (!clientId || !clientSecret) {
      throw new Error("CF_ACCESS_TOKENS entries require clientId and clientSecret");
    }
    return { clientId, clientSecret };
  });
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}
