import type { BenchmarkRun } from "./types";
import { uniqueSorted } from "./utils";

export const formatNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatRsd(value?: number) {
  if (value === undefined) {
    return "n/a";
  }
  return `${formatNumber.format(value * 100)}%`;
}

export function compactRunLabel(run: BenchmarkRun) {
  const explicitLabel = run.label.trim();
  if (explicitLabel && explicitLabel !== run.id && explicitLabel.length <= 24) {
    return explicitLabel;
  }
  const date = parseRunDate(run);
  if (date) {
    return [`${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`, `${pad2(date.getHours())}:${pad2(date.getMinutes())}`].join(" ");
  }
  return run.id.length > 18 ? `${run.id.slice(0, 10)}...${run.id.slice(-5)}` : run.id;
}

export function runTime(run: BenchmarkRun) {
  return parseRunDate(run)?.getTime() ?? 0;
}

function parseRunDate(run: BenchmarkRun) {
  const explicitDate = Date.parse(run.startedAt);
  if (Number.isFinite(explicitDate)) {
    return new Date(explicitDate);
  }
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(run.id);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value);
}

export function formatMetricValue(value: number, unit: string) {
  if (isByteRateUnit(unit)) {
    return formatByteRate(value);
  }
  if (isLatencyUnit(unit)) {
    return formatLatency(value, unit);
  }
  return `${formatCompact(value)} ${displayUnit(unit)}`.trim();
}

export function formatByteRate(bytesPerSecond: number) {
  const units = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] as const;
  let value = bytesPerSecond;
  let unitIndex = 0;
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${formatRateNumber(value)} ${units[unitIndex]}`;
}

function formatRateNumber(value: number) {
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function displayUnit(unit: string) {
  return isByteRateUnit(unit) ? "B/s" : unit;
}

function isByteRateUnit(unit: string) {
  return /^(bytes|byte|b)(\/s|\/sec|\/second| per second)$/iu.test(unit.trim());
}

function isLatencyUnit(unit: string) {
  return /^(ns|nanoseconds?|µs|us|microseconds?|ms|milliseconds?|s|seconds?)(\/op|\/iter|\/iteration)?$/iu.test(unit.trim());
}

function formatLatency(value: number, unit: string) {
  let nanoseconds = value;
  const normalizedUnit = unit.trim().toLowerCase();
  if (/^(µs|us|microseconds?)/u.test(normalizedUnit)) {
    nanoseconds *= 1_000;
  } else if (/^(ms|milliseconds?)/u.test(normalizedUnit)) {
    nanoseconds *= 1_000_000;
  } else if (/^(s|seconds?)/u.test(normalizedUnit)) {
    nanoseconds *= 1_000_000_000;
  }

  const abs = Math.abs(nanoseconds);
  if (abs >= 1_000_000_000) {
    return `${formatRateNumber(nanoseconds / 1_000_000_000)} s/op`;
  }
  if (abs >= 1_000_000) {
    return `${formatRateNumber(nanoseconds / 1_000_000)} ms/op`;
  }
  if (abs >= 1_000) {
    return `${formatRateNumber(nanoseconds / 1_000)} µs/op`;
  }
  return `${formatRateNumber(nanoseconds)} ns/op`;
}

export function formatInputSize(value: number) {
  if (value >= 1_048_576) {
    return `${formatNumber.format(value / 1_048_576)} MiB`;
  }
  if (value >= 1024) {
    return `${formatNumber.format(value / 1024)} KiB`;
  }
  return `${formatNumber.format(value)} B`;
}

export function formatInputValue(value: number, unit?: string) {
  if (!unit || isByteInputUnit(unit)) {
    return formatInputSize(value);
  }
  return `${formatCompact(value)} ${unit}`;
}

function isByteInputUnit(unit: string) {
  return /^(bytes?|b)$/iu.test(unit.trim());
}

export function commonInputUnit(points: Array<{ unit?: string }>) {
  const units = uniqueSorted(points.map((point) => point.unit ?? "").filter(Boolean));
  return units.length === 1 ? units[0] : undefined;
}

export function parseBenchmarkAmount(value: string): { amount: number; unit: string } | undefined {
  const match = value.match(/^([\d.]+)\s*([a-zA-Z]+)/);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("k") ? 1024 : unit.startsWith("m") ? 1_048_576 : 1;
  const normalizedUnit = /^(b|bytes?|kib|kb|mib|mb)$/iu.test(match[2]) ? "bytes" : match[2];
  return { amount: amount * multiplier, unit: normalizedUnit };
}

export function formatLatencyValue(nsPerIteration: number) {
  return formatLatency(nsPerIteration, "ns/op");
}
