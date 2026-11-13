import type { ModelConfig, StructuredOutputFormat } from "../config/schema";
import { isObject } from "../util/json";

export type Warn = (message: string) => void;

export const defaultWarn: Warn = (message) => {
  process.emitWarning(message, { code: "FLECTEN_PROVIDER_SCHEMA" });
};

interface StrictNode {
  ok: boolean;
  value?: unknown;
  reason?: string;
}

function strictNode(value: unknown): StrictNode {
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const entry of value) {
      const next = strictNode(entry);
      if (!next.ok) return next;
      output.push(next.value);
    }
    return { ok: true, value: output };
  }
  if (!isObject(value)) return { ok: true, value };

  if ("patternProperties" in value || "unevaluatedProperties" in value) {
    return { ok: false, reason: "pattern or unevaluated properties are not supported" };
  }
  if ("additionalProperties" in value && value.additionalProperties !== false) {
    return { ok: false, reason: "additionalProperties must be false" };
  }

  const output: Record<string, unknown> = { ...value };
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const branch = value[key];
    if (Array.isArray(branch)) {
      const next = strictNode(branch);
      if (!next.ok) return next;
      output[key] = next.value;
    }
  }
  for (const key of ["$defs", "definitions"] as const) {
    const definitions = value[key];
    if (isObject(definitions)) {
      const next: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(definitions)) {
        const transformed = strictNode(schema);
        if (!transformed.ok) return transformed;
        next[name] = transformed.value;
      }
      output[key] = next;
    }
  }
  if (value.items !== undefined) {
    const next = strictNode(value.items);
    if (!next.ok) return next;
    output.items = next.value;
  }
  if (Array.isArray(value.prefixItems)) {
    const next = strictNode(value.prefixItems);
    if (!next.ok) return next;
    output.prefixItems = next.value;
  }

  if (isObject(value.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [name, schema] of Object.entries(value.properties)) {
      const transformed = strictNode(schema);
      if (!transformed.ok) return transformed;
      properties[name] = transformed.value;
    }
    const required = Array.isArray(value.required)
      ? value.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    output.type = "object";
    output.properties = properties;
    output.required = [...new Set([...required, ...Object.keys(properties)])];
    output.additionalProperties = false;
  } else if (value.type === "object") {
    output.properties = {};
    output.required = [];
    output.additionalProperties = false;
  }

  return { ok: true, value: output };
}

export interface StrictSchemaResult {
  schema: Record<string, unknown>;
  strict: boolean;
  reason?: string;
}

export function strictSchema(parameters: Record<string, unknown>): StrictSchemaResult {
  const result = strictNode(parameters);
  if (!result.ok) {
    return {
      schema: parameters,
      strict: false,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    };
  }
  const schema = result.value as Record<string, unknown>;
  if (schema.type !== "object" && !isObject(schema.properties)) {
    return { schema: parameters, strict: false, reason: "the root schema must be an object" };
  }
  return { schema, strict: true };
}

export function structuredOutputFormat(
  model: ModelConfig | undefined,
): StructuredOutputFormat | undefined {
  const value = model?.structuredOutput;
  return value !== undefined && typeof value === "object" ? value : undefined;
}

export function jsonSchemaFormat(
  format: StructuredOutputFormat,
  warn: Warn,
): { schema: Record<string, unknown>; strict: boolean } {
  if (!format.strict) return { schema: format.schema, strict: false };
  const transformed = strictSchema(format.schema);
  if (transformed.strict) return { schema: transformed.schema, strict: true };
  warn(`structured output for "${format.name}" is not strict-compatible: ${transformed.reason}`);
  return { schema: format.schema, strict: false };
}

function pointer(value: string, root: unknown): unknown {
  if (!value.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of value.slice(2).split("/")) {
    const key = raw.split("~1").join("/").split("~0").join("~");
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function clone(value: unknown, root: unknown, seen: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => clone(entry, root, seen));
  if (!isObject(value)) return value;
  let output: Record<string, unknown> = {};
  if (typeof value.$ref === "string" && !seen.has(value.$ref)) {
    const target = pointer(value.$ref, root);
    if (isObject(target)) {
      const resolved = clone(target, root, new Set([...seen, value.$ref]));
      if (isObject(resolved)) output = resolved;
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" || key === "$defs" || key === "definitions") continue;
    if (key === "$schema" || key === "$id" || key === "$comment") continue;
    output[key] = clone(entry, root, seen);
  }
  return output;
}

export function anthropicSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = clone(schema, schema, new Set());
  const output = isObject(cloned) ? cloned : {};
  if (output.type === undefined && isObject(output.properties)) output.type = "object";
  return output;
}

const GEMINI_DROP = new Set([
  "additionalProperties",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
  "contains",
  "minContains",
  "maxContains",
  "uniqueItems",
]);

function mergeAllOf(branches: unknown[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const branch of branches) {
    if (!isObject(branch)) continue;
    for (const [key, value] of Object.entries(branch)) {
      if (key === "properties" && isObject(value)) {
        output.properties = {
          ...(isObject(output.properties) ? output.properties : {}),
          ...value,
        };
      } else if (key === "required" && Array.isArray(value)) {
        const existing = Array.isArray(output.required) ? output.required : [];
        const next = value.filter((entry): entry is string => typeof entry === "string");
        output.required = [...new Set([...existing, ...next])];
      } else {
        output[key] = value;
      }
    }
  }
  return output;
}

function geminiNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => geminiNode(entry));
  if (!isObject(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (GEMINI_DROP.has(key)) continue;
    if (key === "properties" && isObject(entry)) {
      const properties: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(entry)) {
        properties[name] = geminiNode(schema);
      }
      output.properties = properties;
    } else if (key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf") {
      output[key] = Array.isArray(entry)
        ? entry.map((schema) => geminiNode(schema))
        : geminiNode(entry);
    } else {
      output[key] = geminiNode(entry);
    }
  }

  if (Array.isArray(output.allOf)) {
    const merged = mergeAllOf(output.allOf);
    delete output.allOf;
    for (const [key, entry] of Object.entries(merged)) output[key] = entry;
  }
  if (Array.isArray(output.oneOf)) {
    output.anyOf = output.oneOf;
    delete output.oneOf;
  }
  if ("const" in output) {
    if (output.enum === undefined && typeof output.const === "string") {
      output.enum = [output.const];
    }
    delete output.const;
  }
  if (Array.isArray(output.type)) {
    const types = output.type.filter((entry): entry is string => typeof entry === "string");
    const nonNull = types.filter((entry) => entry !== "null");
    if (types.includes("null")) output.nullable = true;
    if (nonNull.length === 1) output.type = nonNull[0];
    else if (nonNull.length > 1) {
      delete output.type;
      output.anyOf = nonNull.map((entry) => ({ type: entry }));
    } else delete output.type;
  }
  return output;
}

export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = clone(schema, schema, new Set());
  const transformed = geminiNode(cloned);
  return isObject(transformed) ? transformed : {};
}
