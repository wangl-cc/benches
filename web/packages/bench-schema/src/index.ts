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
  readonly groups: readonly JsonObject[];
  readonly measurements: readonly JsonObject[];
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
  "groups",
  "measurements",
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
  allowOnlyKeys(value, "$", REQUIRED_FIELDS, issues);

  requireNonEmptyString(value, "schemaVersion", issues);
  requireNonEmptyString(value, "runId", issues);
  requireIsoDateTime(value, "createdAt", issues);
  requireObjectField(value, "git", issues);
  requireObjectField(value, "host", issues);
  requireObjectField(value, "harness", issues);
  requireObjectArray(value, "groups", issues);
  requireObjectArray(value, "measurements", issues);
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
      groups: value.groups as readonly JsonObject[],
      measurements: value.measurements as readonly JsonObject[],
    },
  };
}

function validateRawRunFields(
  object: JsonObject,
  issues: ValidationIssue[],
): void {
  if (object.schemaVersion !== "bench.run.v3") {
    issues.push({ path: "$.schemaVersion", message: "expected bench.run.v3" });
  }

  if (isObject(object.git)) {
    allowOnlyKeys(object.git, "$.git", ["commit", "branch", "dirty"], issues);
    requireNonEmptyStringAt(object.git, "commit", "$.git.commit", issues);
    requireNonEmptyStringAt(object.git, "branch", "$.git.branch", issues);
    requireBooleanAt(object.git, "dirty", "$.git.dirty", issues);
  }
  if (isObject(object.host)) {
    allowOnlyKeys(
      object.host,
      "$.host",
      ["id", "os", "arch", "cpu", "kernel", "rustc", "llvm"],
      issues,
    );
    requireNonEmptyStringAt(object.host, "id", "$.host.id", issues);
    requireNonEmptyStringAt(object.host, "os", "$.host.os", issues);
    requireNonEmptyStringAt(object.host, "arch", "$.host.arch", issues);
    requireNonEmptyStringAt(object.host, "cpu", "$.host.cpu", issues);
    requireNonEmptyStringAt(object.host, "kernel", "$.host.kernel", issues);
    requireNonEmptyStringAt(object.host, "rustc", "$.host.rustc", issues);
    requireNonEmptyStringAt(object.host, "llvm", "$.host.llvm", issues);
  }
  if (isObject(object.harness)) {
    allowOnlyKeys(
      object.harness,
      "$.harness",
      [
        "name",
        "version",
        "profile",
        "sampleCount",
        "warmupMs",
        "calibrationMinMs",
        "targetSampleMs",
      ],
      issues,
    );
    requireNonEmptyStringAt(object.harness, "name", "$.harness.name", issues);
    requireNonEmptyStringAt(object.harness, "version", "$.harness.version", issues);
    requireStringEnumAt(
      object.harness,
      "profile",
      "$.harness.profile",
      ["quick", "publish"],
      issues,
    );
    requireIntegerAt(object.harness, "sampleCount", "$.harness.sampleCount", 3, issues);
    requireIntegerAt(object.harness, "warmupMs", "$.harness.warmupMs", 1, issues);
    requireIntegerAt(object.harness, "calibrationMinMs", "$.harness.calibrationMinMs", 1, issues);
    requireIntegerAt(object.harness, "targetSampleMs", "$.harness.targetSampleMs", 1, issues);
  }

  const groupDefinitions = new Map<string, { readonly sizes: Set<number>; readonly cases: Set<string> }>();
  if (Array.isArray(object.groups)) {
    if (object.groups.length !== 1) {
      issues.push({ path: "$.groups", message: "expected exactly one group" });
    }
    object.groups.forEach((group, index) => {
      if (!isObject(group)) {
        return;
      }
      allowOnlyKeys(
        group,
        `$.groups[${index}]`,
        ["name", "description", "workload", "sizes", "cases"],
        issues,
      );
      const name = stringField(group, "name");
      if (!name) {
        issues.push({ path: `$.groups[${index}].name`, message: "expected a non-empty string" });
      } else if (groupDefinitions.has(name)) {
        issues.push({ path: `$.groups[${index}].name`, message: `duplicate group ${name}` });
      } else {
        groupDefinitions.set(name, { sizes: new Set(), cases: new Set() });
      }

      const workload = group.workload;
      if (!isObject(workload)) {
        issues.push({ path: `$.groups[${index}].workload`, message: "expected an object" });
      } else {
        allowOnlyKeys(
          workload,
          `$.groups[${index}].workload`,
          ["name", "unit"],
          issues,
        );
        if (!stringField(workload, "name")) {
          issues.push({ path: `$.groups[${index}].workload.name`, message: "expected a non-empty string" });
        }
        if (!stringField(workload, "unit")) {
          issues.push({ path: `$.groups[${index}].workload.unit`, message: "expected a non-empty string" });
        }
      }

      const definition = name ? groupDefinitions.get(name) : undefined;
      const sizes = group.sizes;
      if (!Array.isArray(sizes)) {
        issues.push({ path: `$.groups[${index}].sizes`, message: "expected an array" });
      } else {
        sizes.forEach((size, sizeIndex) => {
          if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
            issues.push({ path: `$.groups[${index}].sizes[${sizeIndex}]`, message: "expected a positive number" });
          } else {
            definition?.sizes.add(size);
          }
        });
      }

      const cases = group.cases;
      if (!Array.isArray(cases)) {
        issues.push({ path: `$.groups[${index}].cases`, message: "expected an array" });
      } else {
        cases.forEach((benchCase, caseIndex) => {
          if (!isObject(benchCase)) {
            issues.push({ path: `$.groups[${index}].cases[${caseIndex}]`, message: "expected an object" });
            return;
          }
          allowOnlyKeys(
            benchCase,
            `$.groups[${index}].cases[${caseIndex}]`,
            ["name", "color"],
            issues,
          );
          const caseName = stringField(benchCase, "name");
          if (!caseName) {
            issues.push({ path: `$.groups[${index}].cases[${caseIndex}].name`, message: "expected a non-empty string" });
          } else if (definition?.cases.has(caseName)) {
            issues.push({ path: `$.groups[${index}].cases[${caseIndex}].name`, message: `duplicate case ${caseName}` });
          } else {
            definition?.cases.add(caseName);
          }
          const color = stringField(benchCase, "color");
          if (!color) {
            issues.push({ path: `$.groups[${index}].cases[${caseIndex}].color`, message: "expected a non-empty string" });
          } else if (!isHexColor(color)) {
            issues.push({ path: `$.groups[${index}].cases[${caseIndex}].color`, message: "expected a #rrggbb color" });
          }
        });
      }
    });
  }

  validateMeasurements(object, groupDefinitions, issues);
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value);
}

function validateMeasurements(
  object: JsonObject,
  groupDefinitions: ReadonlyMap<string, { readonly sizes: ReadonlySet<number>; readonly cases: ReadonlySet<string> }>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(object.measurements)) {
    return;
  }

  const measurementKeys = new Set<string>();
  object.measurements.forEach((measurement, index) => {
    if (!isObject(measurement)) {
      return;
    }
    allowOnlyKeys(
      measurement,
      `$.measurements[${index}]`,
      ["group", "case", "workloadSize", "samples"],
      issues,
    );

    const group = stringField(measurement, "group");
    const benchCase = stringField(measurement, "case");
    const workloadSize = numberField(measurement, "workloadSize");
    if (!group) {
      issues.push({ path: `$.measurements[${index}].group`, message: "expected a non-empty string" });
    }
    if (!benchCase) {
      issues.push({ path: `$.measurements[${index}].case`, message: "expected a non-empty string" });
    }
    if (workloadSize === undefined || workloadSize <= 0) {
      issues.push({ path: `$.measurements[${index}].workloadSize`, message: "expected a positive number" });
    }

    const definition = group ? groupDefinitions.get(group) : undefined;
    if (group && groupDefinitions.size > 0 && !definition) {
      issues.push({ path: `$.measurements[${index}].group`, message: `unknown group ${group}` });
    }
    if (definition && benchCase && !definition.cases.has(benchCase)) {
      issues.push({ path: `$.measurements[${index}].case`, message: `unknown case ${benchCase}` });
    }
    if (definition && workloadSize !== undefined && !definition.sizes.has(workloadSize)) {
      issues.push({ path: `$.measurements[${index}].workloadSize`, message: `unknown workload size ${workloadSize}` });
    }
    if (group && benchCase && workloadSize !== undefined) {
      const key = `${group}\u0000${benchCase}\u0000${workloadSize}`;
      if (measurementKeys.has(key)) {
        issues.push({ path: `$.measurements[${index}]`, message: "duplicate measurement" });
      }
      measurementKeys.add(key);
    }

    const samples = measurement.samples;
    if (!Array.isArray(samples)) {
      issues.push({ path: `$.measurements[${index}].samples`, message: "expected an array" });
      return;
    }
    const expectedSampleCount = isObject(object.harness) ? numberField(object.harness, "sampleCount") : undefined;
    if (
      expectedSampleCount !== undefined &&
      Number.isInteger(expectedSampleCount) &&
      samples.length !== expectedSampleCount
    ) {
      issues.push({
        path: `$.measurements[${index}].samples`,
        message: `expected ${expectedSampleCount} samples`,
      });
    }
    samples.forEach((sample, sampleOffset) => {
      if (!isObject(sample)) {
        issues.push({ path: `$.measurements[${index}].samples[${sampleOffset}]`, message: "expected an object" });
        return;
      }
      allowOnlyKeys(
        sample,
        `$.measurements[${index}].samples[${sampleOffset}]`,
        ["iterations", "elapsedNs"],
        issues,
      );
      requirePositiveNumber(sample, "iterations", `$.measurements[${index}].samples[${sampleOffset}].iterations`, issues);
      requirePositiveNumber(sample, "elapsedNs", `$.measurements[${index}].samples[${sampleOffset}].elapsedNs`, issues);
    });
  });
}

function allowOnlyKeys(
  object: JsonObject,
  path: string,
  allowed: readonly string[],
  issues: ValidationIssue[],
): void {
  const allowedKeys = new Set<string>(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "unknown field" });
    }
  }
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
    !isStrictIsoDateTime(value)
  ) {
    issues.push({ path: `$.${field}`, message: "expected an ISO date-time string" });
  }
}

function isStrictIsoDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
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

function requireNonEmptyStringAt(
  object: JsonObject,
  field: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = object[field];
  if (typeof value !== "string" || value.length === 0) {
    issues.push({ path, message: "expected a non-empty string" });
  }
}

function requireBooleanAt(
  object: JsonObject,
  field: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof object[field] !== "boolean") {
    issues.push({ path, message: "expected a boolean" });
  }
}

function requireStringEnumAt(
  object: JsonObject,
  field: string,
  path: string,
  values: readonly string[],
  issues: ValidationIssue[],
): void {
  const value = object[field];
  if (typeof value !== "string" || !values.includes(value)) {
    issues.push({ path, message: `expected one of ${values.join(", ")}` });
  }
}

function requireIntegerAt(
  object: JsonObject,
  field: string,
  path: string,
  min: number,
  issues: ValidationIssue[],
): void {
  const value = object[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    issues.push({ path, message: `expected an integer >= ${min}` });
  }
}
