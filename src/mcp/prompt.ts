import mcpCatalogsPrompt from "../../prompts/mcp-catalogs.md" with { type: "text" };
import mcpInstructionsPrompt from "../../prompts/mcp-instructions.md" with { type: "text" };
import { markdownData, markdownValue } from "../util/markdown";
import type { McpPrompt } from "./prompts";
import type { McpResource, McpResourceTemplate } from "./resources";

const MAX_INSTRUCTIONS = 4000;
const MAX_TOTAL_INSTRUCTIONS = 16_000;
const MAX_CATALOG_DESCRIPTION = 240;

export const DEFAULT_MCP_CATALOG_BUDGET = 4000;

export interface McpCatalogEntry {
  server: string;
  resources?: readonly McpResource[];
  resourceTemplates?: readonly McpResourceTemplate[];
  prompts?: readonly McpPrompt[];
}

export function renderMcpInstructions(
  entries: Array<{ server: string; text: string }>,
): string | undefined {
  const lines = ["# MCP server guidance", "", mcpInstructionsPrompt.trim()];
  let used = 0;
  let included = 0;
  for (const entry of entries) {
    const remaining = MAX_TOTAL_INSTRUCTIONS - used;
    if (remaining <= 0) break;
    const text = entry.text.trim().slice(0, Math.min(MAX_INSTRUCTIONS, remaining));
    if (text.length === 0) continue;
    lines.push(
      "",
      markdownData(
        "Server guidance",
        [
          ["Server", entry.server],
          ["Authority", "advisory"],
        ],
        text,
      ),
    );
    used += text.length;
    included += 1;
  }
  if (included === 0) return undefined;
  if (included < entries.length)
    lines.push("", `${entries.length - included} server guidance blocks omitted.`);
  return lines.join("\n");
}

function field(name: string, value: string | boolean | undefined): string[] {
  return value === undefined ? [] : [`- ${name}: ${markdownValue(value)}`];
}

function description(value: string | undefined): string[] {
  return field("Description", value?.trim().slice(0, MAX_CATALOG_DESCRIPTION));
}

function resourceText(resource: McpResource): string {
  return [
    "### Resource",
    ...field("Resource URI", resource.uri),
    ...field("Name", resource.name),
    ...field("MIME type", resource.mimeType),
    ...description(resource.description),
  ].join("\n");
}

function templateText(template: McpResourceTemplate): string {
  return [
    "### Resource template",
    ...field("URI template", template.uriTemplate),
    ...field("Name", template.name),
    ...field("MIME type", template.mimeType),
    ...description(template.description),
  ].join("\n");
}

function promptText(prompt: McpPrompt): string {
  return [
    "### Prompt",
    ...field("Name", prompt.name),
    ...description(prompt.description),
    ...(prompt.arguments ?? []).flatMap((argument) => [
      "#### Argument",
      ...field("Name", argument.name),
      ...field("Required", argument.required === true),
      ...description(argument.description),
    ]),
  ].join("\n");
}

export function renderMcpCatalogs(
  entries: readonly McpCatalogEntry[],
  budgetChars: number = DEFAULT_MCP_CATALOG_BUDGET,
): string | undefined {
  const budget = Math.max(0, Math.floor(budgetChars));
  const lines = ["# MCP catalogs", "", mcpCatalogsPrompt.trim()];
  let used = lines.join("\n").length;
  let included = 0;
  let omitted = 0;

  for (const entry of entries) {
    const items = [
      ...(entry.resources ?? []).map(resourceText),
      ...(entry.resourceTemplates ?? []).map(templateText),
      ...(entry.prompts ?? []).map(promptText),
    ];
    let contents = "";
    for (const item of items) {
      const candidate = contents ? `${contents}\n\n${item}` : item;
      const block = markdownData(
        "Server catalog",
        [
          ["Server", entry.server],
          ["Trust", "untrusted"],
        ],
        candidate,
      );
      if (used + block.length + 2 > budget) {
        omitted += 1;
        continue;
      }
      contents = candidate;
      included += 1;
    }
    if (!contents) continue;
    const block = markdownData(
      "Server catalog",
      [
        ["Server", entry.server],
        ["Trust", "untrusted"],
      ],
      contents,
    );
    lines.push("", block);
    used += block.length + 2;
  }

  if (included === 0) return undefined;
  const note = `${omitted} catalog entries omitted.`;
  if (omitted > 0 && used + note.length + 2 <= budget) lines.push("", note);
  return lines.join("\n");
}
