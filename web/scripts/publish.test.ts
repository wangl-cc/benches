import { equal, match } from "node:assert/strict";
import { test } from "node:test";

import { validateBenchRun } from "../packages/bench-schema/src/index.ts";
import { hashRun } from "./publish.ts";
import {
  compressRawRun,
  decompressRawRun,
  deriveSummaries,
  parseUploadTokens,
  validateIngestPolicy,
} from "../worker/src/index.ts";

const validRun = {
  schemaVersion: "bench.run.v3",
  runId: "run-1",
  createdAt: "2026-05-21T00:00:00Z",
  git: { commit: "abc123" },
  host: { id: "host-1" },
  harness: { name: "harness", profile: "publish" },
  groups: [
    {
      name: "Cryptographic Hash",
      description: "Hashes deterministic byte buffers with cryptographic hash functions.",
      workload: { name: "Message size", unit: "bytes" },
      sizes: [64],
      cases: [{ name: "BLAKE3-256", color: "#0f766e" }],
    },
  ],
  measurements: [
    {
      group: "Cryptographic Hash",
      case: "BLAKE3-256",
      workloadSize: 64,
      samples: [{ iterations: 10, elapsedNs: 100 }],
    },
  ],
};

test("validates the publish run contract", () => {
  const result = validateBenchRun(validRun);
  equal(result.ok, true);
});

test("rejects missing top-level fields", () => {
  const result = validateBenchRun({ ...validRun, runId: undefined });
  equal(result.ok, false);
});

test("rejects unknown public raw fields", () => {
  const result = validateBenchRun({
    ...validRun,
    groups: [{ ...validRun.groups[0], extra: true }],
  });
  equal(result.ok, false);
  if (!result.ok) {
    match(result.issues.map((issue) => issue.message).join("\n"), /unknown field/);
  }
});

test("rejects measurements for unknown cases", () => {
  const result = validateBenchRun({
    ...validRun,
    measurements: [{ ...validRun.measurements[0], case: "missing-case" }],
  });
  equal(result.ok, false);
});

test("rejects duplicate case ids", () => {
  const result = validateBenchRun({
    ...validRun,
    groups: [
      {
        ...validRun.groups[0],
        cases: [
          validRun.groups[0].cases[0],
          validRun.groups[0].cases[0],
        ],
      },
    ],
  });
  equal(result.ok, false);
});

test("hashes canonical run JSON", async () => {
  const result = validateBenchRun(validRun);
  if (!result.ok) {
    throw new Error("fixture should be valid");
  }

  const hash = await hashRun(result.value);
  match(hash, /^[a-f0-9]{64}$/);
});

test("production ingest policy rejects quick runs", () => {
  const result = validateBenchRun({
    ...validRun,
    harness: { name: "harness", profile: "quick" },
  });
  if (!result.ok) {
    throw new Error("fixture should be valid");
  }

  const issues = validateIngestPolicy(result.value, { allowQuickRuns: false });
  equal(issues.length, 1);
  match(issues[0], /quick benchmark runs/);
});

test("test ingest policy accepts quick runs", () => {
  const result = validateBenchRun({
    ...validRun,
    harness: { name: "harness", profile: "quick" },
  });
  if (!result.ok) {
    throw new Error("fixture should be valid");
  }

  const issues = validateIngestPolicy(result.value, { allowQuickRuns: true });
  equal(issues.length, 0);
});

test("derives throughput summaries from raw samples", () => {
  const result = validateBenchRun({
    ...validRun,
    groups: [
      {
        name: "Cryptographic Hash",
        description: "Hashes deterministic byte buffers with cryptographic hash functions.",
        workload: { name: "Message size", unit: "bytes" },
        sizes: [64],
        cases: [{ name: "BLAKE3-256", color: "#0f766e" }],
      },
    ],
    measurements: [
      {
        group: "Cryptographic Hash",
        case: "BLAKE3-256",
        workloadSize: 64,
        samples: [
          { iterations: 10, elapsedNs: 100 },
          { iterations: 10, elapsedNs: 120 },
          { iterations: 10, elapsedNs: 110 },
        ],
      },
    ],
  });
  if (!result.ok) {
    throw new Error("fixture should be valid");
  }

  const derived = deriveSummaries(result.value);
  equal(derived.ok, true);
  if (!derived.ok) {
    throw new Error("summary derivation should succeed");
  }

  const summary = derived.summaries[0];
  equal(summary.caseId, "Cryptographic Hash/BLAKE3-256/64");
  equal(summary.metric, "throughput");
  equal(summary.unit, "bytes/s");
  equal(
    summary.workloadDescription,
    "Hashes deterministic byte buffers with cryptographic hash functions.",
  );
  equal(summary.sampleCount, 3);
  equal(summary.value, 64 * 1_000_000_000 / 11);
});

test("parses multi-machine upload tokens", () => {
  const tokens = parseUploadTokens({
    CF_ACCESS_TOKENS: JSON.stringify([
      { clientId: "m3-max.access", clientSecret: "secret-1" },
      { clientId: "ryzen.access", clientSecret: "secret-2" },
    ]),
  });

  equal(tokens.length, 2);
  equal(tokens[0]?.clientId, "m3-max.access");
  equal(tokens[1]?.clientSecret, "secret-2");
});

test("compresses raw run JSON losslessly", async () => {
  const raw = JSON.stringify(validRun);
  const compressed = await compressRawRun(raw);
  equal(compressed.originalBytes, new TextEncoder().encode(raw).byteLength);
  equal(await decompressRawRun(compressed.bytes), raw);
});
