import { t } from "../i18n.svelte";
import type { ElicitationRequest, ElicitationValue } from "./extension-types";

export interface ElicitationField {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  type: "string" | "number" | "integer" | "boolean" | "unsupported";
  options?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}
export function elicitationFields(request: ElicitationRequest): ElicitationField[] {
  return Object.entries(request.requestedSchema?.properties ?? {}).map(([name, raw]) => {
    const schema =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const type = schema.type;
    const field: ElicitationField = {
      name,
      label: typeof schema.title === "string" ? schema.title : name,
      required: request.requestedSchema?.required?.includes(name) === true,
      type:
        type === "string" || type === "number" || type === "integer" || type === "boolean"
          ? type
          : "unsupported",
    };
    if (typeof schema.description === "string") field.description = schema.description;
    if (Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === "string"))
      field.options = schema.enum;
    for (const key of ["minimum", "maximum", "minLength", "maxLength"] as const)
      if (typeof schema[key] === "number") field[key] = schema[key];
    return field;
  });
}
export function elicitationContent(
  fields: ElicitationField[],
  values: Record<string, ElicitationValue>,
): { content: Record<string, ElicitationValue> } | { error: string } {
  const content: Record<string, ElicitationValue> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === "") {
      if (field.required && field.type !== "boolean")
        return { error: t("Fill in “{0}”.", [field.label]) };
      if (field.type === "boolean" && field.required) content[field.name] = false;
      continue;
    }
    if (field.type === "unsupported")
      return {
        error: t("The “{0}” field uses an unsupported schema. Reject the request.", [field.label]),
      };
    if (field.type === "number" || field.type === "integer") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.type === "integer" && !Number.isInteger(value))
      )
        return { error: t("Enter a number in “{0}”.", [field.label]) };
      if (
        (field.minimum !== undefined && value < field.minimum) ||
        (field.maximum !== undefined && value > field.maximum)
      )
        return { error: t("The number in “{0}” is outside the allowed range.", [field.label]) };
    }
    if (typeof value === "string") {
      if (
        (field.minLength !== undefined && value.length < field.minLength) ||
        (field.maxLength !== undefined && value.length > field.maxLength)
      )
        return { error: t("Check the length of “{0}”.", [field.label]) };
      if (field.options && !field.options.includes(value))
        return { error: t("Select a value for “{0}”.", [field.label]) };
    }
    content[field.name] = value;
  }
  return { content };
}
