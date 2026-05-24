export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type BenchRun = JsonObject & {
  readonly schemaVersion: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly git: JsonObject;
  readonly host: JsonObject;
  readonly harness: JsonObject;
  readonly scopes: readonly JsonObject[];
  readonly cases: readonly JsonObject[];
  readonly samples: readonly JsonObject[];
  readonly checksums: JsonObject;
  readonly warnings: readonly string[];
};

export type ValidationIssue = {
  readonly path: string;
  readonly message: string;
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const REQUIRED_FIELDS = [
  "schemaVersion",
  "runId",
  "createdAt",
  "git",
  "host",
  "harness",
  "scopes",
  "cases",
  "samples",
  "checksums",
  "warnings",
] as const;

export function validateBenchRun(value: unknown): ValidationResult<BenchRun> {
  const issues: ValidationIssue[] = [];

  if (!isObject(value)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "expected an object" }],
    };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) {
      issues.push({ path: `$.${field}`, message: "is required" });
    }
  }

  requireNonEmptyString(value, "schemaVersion", issues);
  requireNonEmptyString(value, "runId", issues);
  requireIsoDateTime(value, "createdAt", issues);
  requireObjectField(value, "git", issues);
  requireObjectField(value, "host", issues);
  requireObjectField(value, "harness", issues);
  requireObjectArray(value, "scopes", issues);
  requireObjectArray(value, "cases", issues);
  requireObjectArray(value, "samples", issues);
  requireObjectField(value, "checksums", issues);
  requireStringArray(value, "warnings", issues);
  validateRawRunFields(value, issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      ...value,
      schemaVersion: value.schemaVersion as string,
      runId: value.runId as string,
      createdAt: value.createdAt as string,
      git: value.git as JsonObject,
      host: value.host as JsonObject,
      harness: value.harness as JsonObject,
      scopes: value.scopes as readonly JsonObject[],
      cases: value.cases as readonly JsonObject[],
      samples: value.samples as readonly JsonObject[],
      checksums: value.checksums as JsonObject,
      warnings: value.warnings as readonly string[],
    },
  };
}

function validateRawRunFields(
  object: JsonObject,
  issues: ValidationIssue[],
): void {
  if (object.schemaVersion !== "bench.run.v2") {
    issues.push({ path: "$.schemaVersion", message: "expected bench.run.v2" });
  }

  if (Array.isArray(object.scopes)) {
    const scopeIds = new Set<string>();
    object.scopes.forEach((scope, index) => {
      if (!isObject(scope)) {
        return;
      }
      const id = stringField(scope, "id") ?? stringField(scope, "scopeId");
      if (!id) {
        issues.push({ path: `$.scopes[${index}].id`, message: "expected a non-empty string" });
      } else if (scopeIds.has(id)) {
        issues.push({ path: `$.scopes[${index}].id`, message: `duplicate scope id ${id}` });
      } else {
        scopeIds.add(id);
      }
    });
  }

  const caseIds = new Set<string>();
  if (Array.isArray(object.cases)) {
    object.cases.forEach((benchCase, index) => {
      if (!isObject(benchCase)) {
        return;
      }
      const id = stringField(benchCase, "id") ?? stringField(benchCase, "caseId");
      if (!id) {
        issues.push({ path: `$.cases[${index}].id`, message: "expected a non-empty string" });
      } else if (caseIds.has(id)) {
        issues.push({ path: `$.cases[${index}].id`, message: `duplicate case id ${id}` });
      } else {
        caseIds.add(id);
      }
      if (!stringField(benchCase, "scopeId") && !stringField(benchCase, "scope")) {
        issues.push({ path: `$.cases[${index}].scopeId`, message: "expected a non-empty string" });
      }
      if (!stringField(benchCase, "group")) {
        issues.push({ path: `$.cases[${index}].group`, message: "expected a non-empty string" });
      }
      if (!stringField(benchCase, "workloadDescription")) {
        issues.push({ path: `$.cases[${index}].workloadDescription`, message: "expected a non-empty string" });
      }
      if (!stringField(benchCase, "algorithm")) {
        issues.push({ path: `$.cases[${index}].algorithm`, message: "expected a non-empty string" });
      }
      const algorithmColor = stringField(benchCase, "algorithmColor");
      if (!algorithmColor) {
        issues.push({ path: `$.cases[${index}].algorithmColor`, message: "expected a non-empty string" });
      } else if (!isHexColor(algorithmColor)) {
        issues.push({ path: `$.cases[${index}].algorithmColor`, message: "expected a #rrggbb color" });
      }
      const input = benchCase.input;
      if (!isObject(input)) {
        issues.push({ path: `$.cases[${index}].input`, message: "expected an object" });
        return;
      }
      requirePositiveNumber(input, "amount", `$.cases[${index}].input.amount`, issues);
      if (!stringField(input, "unit")) {
        issues.push({ path: `$.cases[${index}].input.unit`, message: "expected a non-empty string" });
      }
    });
  }

  if (Array.isArray(object.samples)) {
    object.samples.forEach((sample, index) => {
      if (!isObject(sample)) {
        return;
      }
      const id = stringField(sample, "caseId") ?? stringField(sample, "case");
      if (!id) {
        issues.push({ path: `$.samples[${index}].caseId`, message: "expected a non-empty string" });
      } else if (caseIds.size > 0 && !caseIds.has(id)) {
        issues.push({ path: `$.samples[${index}].caseId`, message: `unknown case id ${id}` });
      }
      requirePositiveNumber(sample, "iterations", `$.samples[${index}].iterations`, issues);
      requirePositiveNumber(sample, "elapsedNs", `$.samples[${index}].elapsedNs`, issues);
    });
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value);
}

export function parseBenchRunJson(text: string): ValidationResult<BenchRun> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          message: error instanceof Error ? error.message : "invalid JSON",
        },
      ],
    };
  }

  return validateBenchRun(value);
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

export function validationMessage(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}

export function stringField(
  object: JsonObject,
  field: string,
): string | undefined {
  const value = object[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberField(
  object: JsonObject,
  field: string,
): number | undefined {
  const value = object[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isObject(value);
}

function requireNonEmptyString(
  object: JsonObject,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!(field in object)) {
    return;
  }
  if (typeof object[field] !== "string" || object[field].length === 0) {
    issues.push({ path: `$.${field}`, message: "expected a non-empty string" });
  }
}

function requireIsoDateTime(
  object: JsonObject,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!(field in object)) {
    return;
  }
  const value = object[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Number.isNaN(Date.parse(value))
  ) {
    issues.push({ path: `$.${field}`, message: "expected an ISO date-time string" });
  }
}

function requireObjectField(
  object: JsonObject,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!(field in object)) {
    return;
  }
  if (!isObject(object[field])) {
    issues.push({ path: `$.${field}`, message: "expected an object" });
  }
}

function requireObjectArray(
  object: JsonObject,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!(field in object)) {
    return;
  }

  const value = object[field];
  if (!Array.isArray(value)) {
    issues.push({ path: `$.${field}`, message: "expected an array" });
    return;
  }

  value.forEach((entry, index) => {
    if (!isObject(entry)) {
      issues.push({ path: `$.${field}[${index}]`, message: "expected an object" });
    }
  });
}

function requirePositiveNumber(
  object: JsonObject,
  field: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = numberField(object, field);
  if (value === undefined || value <= 0) {
    issues.push({ path, message: "expected a positive number" });
  }
}

function requireStringArray(
  object: JsonObject,
  field: string,
  issues: ValidationIssue[],
): void {
  if (!(field in object)) {
    return;
  }

  const value = object[field];
  if (!Array.isArray(value)) {
    issues.push({ path: `$.${field}`, message: "expected an array" });
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      issues.push({ path: `$.${field}[${index}]`, message: "expected a string" });
    }
  });
}
