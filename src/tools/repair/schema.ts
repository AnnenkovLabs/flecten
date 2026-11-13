import { isObject } from "../../util/json";
import { FIELD_ALIASES, PATH_KEYS } from "./aliases";

export type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
};

export type PathSegment = string | number;

export function schemaType(node: JsonSchemaNode | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) {
    const types = node.type.filter((type) => type !== "null");
    return types.length === 1 ? types[0] : undefined;
  }
  if (node.properties) return "object";
  if (node.items) return "array";
  return undefined;
}

export function schemaAt(root: JsonSchemaNode, path: PathSegment[]): JsonSchemaNode | undefined {
  let node: JsonSchemaNode | undefined = root;
  for (const segment of path) {
    if (!node) return undefined;
    if (typeof segment === "number") {
      node = node.items;
    } else if (node.properties) {
      node = node.properties[segment];
    } else if (schemaType(node) === "array") {
      node = node.items;
    } else {
      return undefined;
    }
  }
  return node;
}

export function navigate(value: unknown, path: PathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isObject(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

export function setValue(root: unknown, path: PathSegment[], value: unknown): boolean {
  if (path.length === 0) return false;
  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  const parent = navigate(root, parentPath);
  if (key === undefined) return false;
  if (typeof key === "number") {
    if (!Array.isArray(parent)) return false;
    parent[key] = value;
    return true;
  }
  if (!isObject(parent)) return false;
  parent[key] = value;
  return true;
}

export function deleteValue(root: unknown, path: PathSegment[]): boolean {
  if (path.length === 0) return false;
  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  const parent = navigate(root, parentPath);
  if (key === undefined) return false;
  if (typeof key === "number") {
    if (!Array.isArray(parent)) return false;
    parent.splice(key, 1);
    return true;
  }
  if (!isObject(parent)) return false;
  delete parent[key];
  return true;
}

export function fieldKey(path: PathSegment[]): string | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const segment = path[index];
    if (typeof segment === "string") return segment;
  }
  return undefined;
}

export function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function unwrapMarkdownLink(value: string): string | undefined {
  const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value.trim());
  if (!match) return undefined;
  const label = match[1] ?? "";
  const target = (match[2] ?? "").replace(/^[a-z]+:\/\//i, "");
  if (target === label || target.endsWith(`/${label}`)) return target;
  return undefined;
}

export function note(notes: string[], text: string): void {
  if (!notes.includes(text)) notes.push(text);
}

export function applyAliases(
  value: unknown,
  schema: JsonSchemaNode,
  toolName: string,
  notes: string[],
): void {
  if (Array.isArray(value)) {
    if (schema.items) {
      for (const entry of value) applyAliases(entry, schema.items, toolName, notes);
    }
    return;
  }
  if (!isObject(value) || !schema.properties) return;

  const aliases = FIELD_ALIASES[toolName] ?? {};
  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (!(canonical in schema.properties)) continue;
    if (!isEmptyValue(value[canonical])) continue;
    for (const candidate of candidates) {
      if (!(candidate in value)) continue;
      const candidateValue = value[candidate];
      if (isEmptyValue(candidateValue)) continue;
      value[canonical] = candidateValue;
      delete value[candidate];
      note(
        notes,
        `Renamed \`${candidate}\` to \`${canonical}\` for "${toolName}". Use \`${canonical}\` next time.`,
      );
      break;
    }
  }

  for (const [key, child] of Object.entries(schema.properties)) {
    if (key in value) applyAliases(value[key], child, toolName, notes);
  }
}

export function applyPathLinks(value: unknown, schema: JsonSchemaNode, notes: string[]): void {
  if (Array.isArray(value)) {
    if (schema.items) {
      for (const entry of value) applyPathLinks(entry, schema.items, notes);
    }
    return;
  }
  if (!isObject(value) || !schema.properties) return;
  for (const [key, child] of Object.entries(schema.properties)) {
    if (!(key in value)) continue;
    if (PATH_KEYS.has(key) && schemaType(child) === "string" && typeof value[key] === "string") {
      const unwrapped = unwrapMarkdownLink(value[key] as string);
      if (unwrapped) {
        value[key] = unwrapped;
        note(notes, `Stripped markdown link from \`${key}\`.`);
      }
      continue;
    }
    applyPathLinks(value[key], child, notes);
  }
}

export function dropUnknown(
  value: unknown,
  schema: JsonSchemaNode,
  toolName: string,
  notes: string[],
): void {
  if (Array.isArray(value)) {
    if (schema.items) {
      for (const entry of value) dropUnknown(entry, schema.items, toolName, notes);
    }
    return;
  }
  if (!isObject(value) || !schema.properties) return;

  const aliases = FIELD_ALIASES[toolName] ?? {};
  for (const key of Object.keys(value)) {
    if (key in schema.properties) {
      dropUnknown(value[key], schema.properties[key] ?? {}, toolName, notes);
      continue;
    }

    const stripped = key.replace(/[?*]$/, "");
    if (stripped !== key && stripped in schema.properties && isEmptyValue(value[stripped])) {
      value[stripped] = value[key];
      delete value[key];
      note(notes, `Renamed \`${key}\` to \`${stripped}\` for "${toolName}".`);
      continue;
    }

    let renamed = false;
    for (const [canonical, candidates] of Object.entries(aliases)) {
      if (!candidates.includes(key) || !(canonical in schema.properties)) continue;
      if (!isEmptyValue(value[canonical])) continue;
      value[canonical] = value[key];
      delete value[key];
      note(notes, `Renamed \`${key}\` to \`${canonical}\` for "${toolName}".`);
      renamed = true;
      break;
    }
    if (renamed) continue;

    if (schema.additionalProperties === false) {
      delete value[key];
      note(notes, `Dropped unknown field \`${key}\` for "${toolName}".`);
    }
  }
}
