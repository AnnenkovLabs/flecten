import { markdownData, markdownValue } from "../util/markdown";
import type { McpPromptResult } from "./prompts";
import type { McpResourceContent } from "./resources";
import { mcpBlockText } from "./tools";

export const DEFAULT_MCP_CONTEXT_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;
const TRUNCATION_MARKER = "\n\n[MCP context truncated to token budget]";

export interface McpContextResult {
  server: string;
  kind: "resource" | "prompt";
  reference: string;
  text: string;
  tokens: number;
  truncated: boolean;
  untrusted: true;
}

export interface McpContextBudget {
  text: string;
  tokens: number;
  truncated: boolean;
}

// ponytail: coarse 4 chars/token budget, swap in the context tokenizer when
// exact accounting or non-Latin parity matters.
export function estimateMcpTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateMcpContext(text: string, budgetTokens: number): McpContextBudget {
  const budget = Math.max(1, Math.floor(budgetTokens));
  const maxChars = budget * CHARS_PER_TOKEN;
  if (text.length <= maxChars) {
    return { text, tokens: estimateMcpTokens(text), truncated: false };
  }
  const marker = TRUNCATION_MARKER.slice(0, maxChars);
  const kept = text.slice(0, Math.max(0, maxChars - marker.length));
  const truncated = `${kept}${marker}`;
  return {
    text: truncated,
    tokens: estimateMcpTokens(truncated),
    truncated: true,
  };
}

/** Reserve the metadata and closing fence before clipping the source content. */
function contextData(
  title: string,
  fields: ReadonlyArray<readonly [string, string | undefined]>,
  text: string,
  budgetTokens: number,
): McpContextBudget {
  const maxChars = Math.max(1, Math.floor(budgetTokens)) * CHARS_PER_TOKEN;
  const full = markdownData(title, fields, text);
  if (full.length <= maxChars)
    return { text: full, tokens: estimateMcpTokens(full), truncated: false };
  const valueLimit = Math.max(8, Math.floor(maxChars / (fields.length * 4)));
  const compactFields = fields.map(
    ([name, value]) =>
      [
        name,
        value !== undefined && value.length > valueLimit
          ? `${value.slice(0, valueLimit)}...`
          : value,
      ] as const,
  );
  const render = (length: number) =>
    markdownData(title, compactFields, `${text.slice(0, length)}${TRUNCATION_MARKER}`);
  let low = 0;
  let high = Math.min(text.length, maxChars);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (render(middle).length <= maxChars) low = middle;
    else high = middle - 1;
  }
  const bounded = render(low);
  if (bounded.length > maxChars)
    return {
      ...truncateMcpContext(
        "MCP context unavailable: token budget cannot include source metadata.",
        budgetTokens,
      ),
      truncated: true,
    };
  return { text: bounded, tokens: estimateMcpTokens(bounded), truncated: true };
}

function resourceBody(contents: readonly McpResourceContent[]): string {
  return contents
    .map((content) =>
      content.kind === "text"
        ? content.text
        : `[blob ${content.mimeType ?? "application/octet-stream"}, ${Math.floor((content.blob.length * 3) / 4)} bytes]`,
    )
    .join("\n\n");
}

export function renderResourceContext(
  server: string,
  uri: string,
  contents: readonly McpResourceContent[],
  budgetTokens: number,
): McpContextResult {
  const mimeType = contents.find((content) => content.mimeType !== undefined)?.mimeType;
  const budget = contextData(
    "MCP resource",
    [
      ["Server", server],
      ["Resource URI", uri],
      ["MIME type", mimeType],
      ["Trust", "untrusted"],
    ],
    resourceBody(contents),
    budgetTokens,
  );
  return {
    server,
    kind: "resource",
    reference: uri,
    text: budget.text,
    tokens: budget.tokens,
    truncated: budget.truncated,
    untrusted: true,
  };
}

export function renderPromptContext(
  server: string,
  name: string,
  result: McpPromptResult,
  budgetTokens: number,
): McpContextResult {
  const messages = result.messages.map((message, index) => {
    const text = mcpBlockText(message.content);
    return `### Message ${index + 1}\n\n- Role: ${markdownValue(message.role)}\n\n${text}`;
  });
  const budget = contextData(
    "MCP prompt",
    [
      ["Server", server],
      ["Prompt name", name],
      ["Trust", "untrusted"],
      ["Description", result.description],
    ],
    messages.join("\n\n"),
    budgetTokens,
  );
  return {
    server,
    kind: "prompt",
    reference: name,
    text: budget.text,
    tokens: budget.tokens,
    truncated: budget.truncated,
    untrusted: true,
  };
}
