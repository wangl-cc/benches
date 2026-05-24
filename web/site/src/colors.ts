import type { BenchmarkResult } from "./types";
import { asRecord, stringValue } from "./utils";

const fallbackAlgorithmColors = [
  "#0f766e",
  "#14b8a6",
  "#ea580c",
  "#f59e0b",
  "#0891b2",
  "#db2777",
  "#7c3aed",
  "#475569",
];

const knownAlgorithmColors: Record<string, string> = {
  "BLAKE3-256": "#0f766e",
  "BLAKE2B-512": "#14b8a6",
  "SHA2-256": "#ea580c",
  "SHA2-512": "#f59e0b",
  "XXH3-64": "#0891b2",
  "XXH3-128": "#06b6d4",
  "RAPIDHASH-64": "#db2777",
  "GXHASH-64": "#7c3aed",
  "GXHASH-128": "#a855f7",
  "XOR-64-ILP": "#64748b",
  "XOR-128-SIMD": "#94a3b8",
  "PCG64": "#1d4ed8",
  "PCG64-MCG": "#3b82f6",
  "PCG64DXSM": "#60a5fa",
  "xoshiro256++": "#be123c",
  "xoshiro256**": "#f43f5e",
};

export function buildAlgorithmColorMap(rows: BenchmarkResult[]) {
  const colors = new Map<string, string>();
  for (const row of rows) {
    if (row.algorithmColor && !colors.has(row.algorithm)) {
      colors.set(row.algorithm, row.algorithmColor);
    }
  }
  return colors;
}

export function colorForAlgorithm(algorithm: string, preferredColor?: string) {
  if (preferredColor) {
    return preferredColor;
  }
  const configured = asRecord((globalThis as { __BENCH_CHART_CONFIG__?: unknown }).__BENCH_CHART_CONFIG__);
  const colors = asRecord(configured.algorithmColors);
  const color = stringValue(colors[algorithm]);
  if (color) {
    return color;
  }
  if (knownAlgorithmColors[algorithm]) {
    return knownAlgorithmColors[algorithm];
  }
  const hash = [...algorithm].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return fallbackAlgorithmColors[hash % fallbackAlgorithmColors.length];
}

export function normalizeColor(value?: string) {
  if (!value) {
    return undefined;
  }
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : undefined;
}

export function colorForRsd(value?: number) {
  if (value === undefined) {
    return "#cbd5e1";
  }
  if (value < 0.01) {
    return "#0f766e";
  }
  if (value < 0.02) {
    return "#eab308";
  }
  if (value < 0.05) {
    return "#f97316";
  }
  return "#dc2626";
}
