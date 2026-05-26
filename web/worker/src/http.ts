import type { JsonValue } from "../../packages/bench-schema/src/index.ts";

export function addFilter(
  filters: string[],
  values: unknown[],
  column: string,
  value: string | null,
): void {
  if (!value) {
    return;
  }
  filters.push(`${column} = ?`);
  values.push(value);
}

export function readLimit(url: URL, defaultLimit: number, maxLimit: number): number {
  const requested = Number(url.searchParams.get("limit") ?? defaultLimit);
  if (!Number.isInteger(requested) || requested < 1) {
    return defaultLimit;
  }
  return Math.min(requested, maxLimit);
}

export function readOffset(url: URL): number {
  const requested = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(requested) || requested < 0) {
    return 0;
  }
  return requested;
}

export function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers":
      "content-type, cf-access-client-id, cf-access-client-secret, x-bench-content-sha256",
  };
}

export function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}
