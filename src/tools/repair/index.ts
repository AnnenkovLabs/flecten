import { isObject, parseToolArgs } from "../../util/json";
import type { Tool } from "../types";
import { PATH_KEYS, PRIMARY_FIELD, resolveToolAlias } from "./aliases";
import {
  applyAliases,
  applyPathLinks,
  deleteValue,
  dropUnknown,
  fieldKey,
  type JsonSchemaNode,
  navigate,
  note,
  type PathSegment,
  schemaAt,
  schemaType,
  setValue,
  unwrapMarkdownLink,
} from "./schema";

export { resolveToolAlias };

export interface RepairedInput {
  input: Record<string, unknown>;
  notes: string[];
  correction?: string;
}

function repairPath(
  root: Record<string, unknown>,
  path: PathSegment[],
  schema: JsonSchemaNode,
  notes: string[],
): void {
  if (path.length === 0) return;
  const key = path.at(-1);
  const field = fieldKey(path);
  if (key === undefined || field === undefined) return;

  const parentPath = path.slice(0, -1);
  const parentNode = schemaAt(schema, parentPath);
  const node = schemaAt(schema, path);
  if (!node) return;

  const parent = navigate(root, parentPath);
  const value =
    typeof key === "number" && Array.isArray(parent)
      ? parent[key]
      : isObject(parent)
        ? parent[key]
        : undefined;
  const required = parentNode?.required?.includes(field) ?? false;
  const type = schemaType(node);

  if (!required && (value === null || value === undefined)) {
    if (deleteValue(root, path)) {
      note(
        notes,
        `Dropped ${value === null ? "null" : "undefined"} \`${field}\`; omit optional fields instead.`,
      );
    }
    return;
  }

  if (type === "array") {
    if (isObject(value) && Object.keys(value).length === 0) {
      if (deleteValue(root, path)) {
        note(notes, `Dropped empty object placeholder from \`${field}\`; send an array instead.`);
      }
      return;
    }
    if (typeof value === "string" && value.trim().startsWith("[")) {
      const parsed = parseToolArgs(value);
      if (Array.isArray(parsed)) {
        setValue(root, path, parsed);
        note(notes, `Parsed JSON-stringified array \`${field}\`.`);
        return;
      }
    }
    if (!Array.isArray(value) && value !== undefined && value !== null) {
      setValue(root, path, [value]);
      note(notes, `Wrapped bare \`${field}\` in a one-element array.`);
    }
    return;
  }

  if (type === "object") {
    if (typeof value === "string" && value.trim().startsWith("{")) {
      const parsed = parseToolArgs(value);
      if (isObject(parsed)) {
        setValue(root, path, parsed);
        note(notes, `Parsed JSON-stringified object \`${field}\`.`);
      }
    }
    return;
  }

  if (type === "number" && typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setValue(root, path, parsed);
      note(notes, `Coerced string \`${field}\` to a number.`);
    }
    return;
  }

  if (type === "boolean" && (value === "true" || value === "false")) {
    setValue(root, path, value === "true");
    note(notes, `Coerced string \`${field}\` to a boolean.`);
    return;
  }

  if (type === "string" && PATH_KEYS.has(field) && typeof value === "string") {
    const unwrapped = unwrapMarkdownLink(value);
    if (unwrapped) {
      setValue(root, path, unwrapped);
      note(notes, `Stripped markdown link from \`${field}\`.`);
    }
  }
}

interface ToolIssue {
  path: PropertyKey[];
  message: string;
}

function formatCorrection(
  tool: Tool,
  issues: ToolIssue[],
  notes: string[],
  original: Record<string, unknown>,
): string {
  const lines = [`Invalid arguments for tool "${tool.name}". Fix them and retry.`];
  for (const issue of issues.slice(0, 12)) {
    const path = issue.path.map(String).join(".") || "(root)";
    lines.push(`- ${path}: ${issue.message}`);
  }
  lines.push(`Received fields: ${Object.keys(original).join(", ") || "(none)"}`);
  if (notes.length > 0) {
    lines.push("Recognized corrections:", ...notes.map((entry) => `- ${entry}`));
  }
  lines.push("Send the complete call again in the schema above.");
  return lines.join("\n");
}

export function repairToolInput(tool: Tool, raw: unknown): RepairedInput {
  const notes: string[] = [];
  const parsed = parseToolArgs(raw);
  const primary = PRIMARY_FIELD[tool.name];

  let inputValue = parsed;
  if (typeof inputValue === "string" && primary) {
    inputValue = { [primary]: inputValue };
    note(notes, `Wrapped a bare string as \`{ ${primary}: "..." }\` for "${tool.name}".`);
  }

  if (!isObject(inputValue)) {
    return {
      input: {},
      notes,
      correction: `Invalid arguments for tool "${tool.name}": expected a JSON object, received ${typeof inputValue}.`,
    };
  }

  const original = { ...inputValue };
  const input: Record<string, unknown> = { ...inputValue };
  const schema = tool.parameters as JsonSchemaNode;

  applyAliases(input, schema, tool.name, notes);
  dropUnknown(input, schema, tool.name, notes);
  applyPathLinks(input, schema, notes);

  let issues: ToolIssue[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const result = tool.schema.safeParse(input);
    if (result.success) return { input, notes };
    issues = result.error.issues as ToolIssue[];
    for (const issue of issues.slice(0, 20)) {
      repairPath(input, issue.path as PathSegment[], schema, notes);
    }
    applyAliases(input, schema, tool.name, notes);
    dropUnknown(input, schema, tool.name, notes);
  }

  const final = tool.schema.safeParse(input);
  if (final.success) return { input, notes };

  return {
    input,
    notes,
    correction: formatCorrection(tool, final.error.issues as ToolIssue[], notes, original),
  };
}
