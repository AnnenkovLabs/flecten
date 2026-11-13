import { z } from "zod";
import {
  type ContextMessage,
  type ContextSummary,
  type ContextToolCall,
  estimateTokens,
  type SummarizeContext,
} from "../../context";
import { markdownCode, markdownValue } from "../../util/markdown";
import { PageCommandSchema } from "./control";

export const PageSummaryResponseSchema = z
  .object({
    progress: z.string().trim().min(1),
    locations: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
    nextSteps: z.string().trim().min(1),
    risks: z.string().trim().min(1),
  })
  .strict();

export const PAGE_FIELDS = ["changed", "where", "rules", "next", "risks"] as const;
export type PageField = (typeof PAGE_FIELDS)[number];
export type PageSummary = ContextSummary["fields"];

export const ContextSummarySchema = z
  .object({
    page: z.number().int().nonnegative(),
    fields: z
      .object({
        changed: z.string(),
        where: z.string(),
        rules: z.string(),
        next: z.string(),
        risks: z.string(),
      })
      .strict(),
    originalRequest: z.string().optional(),
    latestRequest: z.string().optional(),
    activePage: z
      .object({ title: z.string().min(1), objective: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

const FIELD_TITLES: Record<PageField, string> = {
  changed: "Changed",
  where: "Where",
  rules: "Rules to keep",
  next: "Next step",
  risks: "Open risks",
};

const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch", "delete", "move"]);
const MAX_REQUEST_CHARS = 4000;
const MAX_LINE_CHARS = 240;

function clip(text: string, limit: number): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}...`;
}

function oneLine(text: string, limit = MAX_LINE_CHARS): string {
  return clip(text.split("\n").join(" "), limit);
}

/** Standard JSON response, schema checked before it can replace model history. */
export function parsePageSummary(text: string): PageSummary | undefined {
  try {
    const { progress, locations, instructions, nextSteps, risks } = PageSummaryResponseSchema.parse(
      JSON.parse(text),
    );
    return { changed: progress, where: locations, rules: instructions, next: nextSteps, risks };
  } catch {
    return undefined;
  }
}

function argPath(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file", "file_path", "target", "cwd"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function argCommand(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>).command;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bullets(lines: readonly string[], empty: string, previous?: string): string {
  const unique = [...new Set(lines)].slice(-24);
  return (
    [previous, ...unique.map((line) => `- ${line}`)].filter(Boolean).join("\n") || `- ${empty}`
  );
}

function previousSummary(messages: readonly ContextMessage[]): ContextSummary | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.contextSummary) return message.contextSummary;
  }
  return undefined;
}

function latestRequest(messages: readonly ContextMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (message.contextSummary) return message.contextSummary.latestRequest;
    return message.content;
  }
  return undefined;
}

/** Fallback page built only from structured tool calls and messages, no model call. */
export function deterministicPage(messages: readonly ContextMessage[]): PageSummary {
  const changed: string[] = [];
  const where: string[] = [];
  const rules: string[] = [];
  const risks: string[] = [];
  const previous = previousSummary(messages)?.fields;
  const request = latestRequest(messages);
  const pending = new Map<string, ContextToolCall>();
  const unpaired: ContextToolCall[] = [];
  let nextPage: string | undefined;

  const describeCall = (call: ContextToolCall): string => {
    const command = argCommand(call.args);
    return command
      ? `${call.name} \`${oneLine(command, 160)}\``
      : `${call.name} ${argPath(call.args) ?? ""}`.trim();
  };

  for (const message of messages) {
    if (message.role === "user") {
      if (!message.contextSummary) rules.push(`User: ${oneLine(message.content)}`);
      continue;
    }
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (call.id) pending.set(call.id, call);
        else unpaired.push(call);
        const path = argPath(call.args);
        if (path) where.push(path);
      }
      continue;
    }
    const call = pending.get(message.toolCallId);
    if (!call || call.name !== message.name) {
      risks.push(`${message.name} result has no matching call: ${oneLine(message.content)}`);
      continue;
    }
    pending.delete(message.toolCallId);
    if (call.name === "context" && !message.isError) {
      const command = PageCommandSchema.safeParse(call.args);
      if (command.success && command.data.op === "complete") {
        changed.push(command.data.summary, ...command.data.evidence);
        nextPage = command.data.next;
      } else if (command.success && command.data.op === "block") {
        risks.push(`Unfinished logical page: ${command.data.summary}`, ...command.data.evidence);
        nextPage = command.data.next;
      }
    }
    if (message.isError) {
      risks.push(`${describeCall(call)} failed; effects unverified: ${oneLine(message.content)}`);
    } else if (MUTATING_TOOLS.has(call.name) || argCommand(call.args)) {
      changed.push(`${describeCall(call)} returned successfully: ${oneLine(message.content)}`);
    }
  }

  for (const call of [...pending.values(), ...unpaired]) {
    risks.push(`${describeCall(call)} result unavailable; execution and effects unverified`);
  }

  return {
    changed: bullets(changed, "no file changes or commands recorded", previous?.changed),
    where: bullets(where, "no paths recorded", previous?.where),
    rules: bullets(rules, "no explicit rules recorded", previous?.rules),
    next: nextPage
      ? `- ${nextPage}\n\nContinue the user's latest request${request ? `:\n${request}` : ""}`
      : `- Continue the user's latest request${request ? `:\n${request}` : ""}`,
    risks: bullets(risks, "none recorded", previous?.risks),
  };
}

/** First user message of the summarized span: the task statement survives verbatim. */
export function originalRequest(messages: readonly ContextMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.contextSummary) {
      if (message.contextSummary.originalRequest) return message.contextSummary.originalRequest;
      continue;
    }
    return clip(message.content, MAX_REQUEST_CHARS);
  }
  return undefined;
}

/** All deterministic paths use this same structured continuation, including repeated compaction. */
export function continuationPage(
  messages: readonly ContextMessage[],
  context: SummarizeContext,
  fields = deterministicPage(messages),
  page = (previousSummary(messages)?.page ?? 0) + 1,
  pointers?: Pick<PageRender, "path" | "logsDir">,
): ContextSummary {
  const request = originalRequest(messages);
  const latest = latestRequest(messages);
  const result: ContextSummary = {
    page,
    fields: { ...fields },
    ...(request ? { originalRequest: request } : {}),
    ...(latest ? { latestRequest: latest } : {}),
    ...(context.activePage ? { activePage: context.activePage } : {}),
  };
  // ponytail: bounded excerpts retain the latest outcomes; full pages/logs remain the recovery path.
  // If even the five headings cannot fit, fail before replacing history rather than silently overfill it.
  while (
    estimateTokens(renderContinuation(result, pointers), context.profile).tokens >
    context.targetTokens
  ) {
    const field = PAGE_FIELDS.reduce((longest, current) =>
      result.fields[current].length > result.fields[longest].length ? current : longest,
    );
    if (result.fields[field].length <= 32)
      throw new Error("Context summary budget cannot fit five fields");
    const text = result.fields[field];
    const size = Math.max(24, Math.floor(text.length * 0.75));
    result.fields[field] =
      field === "next" ? `${text.slice(0, size)}...` : `...${text.slice(-size)}`;
  }
  return result;
}

export function renderContinuation(
  value: ContextSummary,
  pointers?: Pick<PageRender, "path" | "logsDir">,
): string {
  const page = pageContextMessage({
    page: value.page,
    summary: value.fields,
    request: value.originalRequest,
    ...pointers,
  });
  return value.activePage
    ? `${page}\n\n## Active logical page\n${value.activePage.title}\n\n${value.activePage.objective}\n\nContinue this page and call context complete before beginning another.`
    : page;
}

export const PAGE_HEADER = "Context summary from earlier work";

export interface PageRender {
  page: number;
  summary: PageSummary;
  request?: string | undefined;
  path?: string | undefined;
  logsDir?: string | undefined;
}

export function renderPage(input: PageRender): string {
  const sections = PAGE_FIELDS.map((field) => `## ${FIELD_TITLES[field]}\n${input.summary[field]}`);
  const lines = [`# Page ${input.page}`, "", ...sections.flatMap((section) => [section, ""])];
  if (input.request) lines.push("## Original request (verbatim)", input.request, "");
  return lines.join("\n").trim();
}

/** The user message that replaces compacted turns. It points to the full pages on disk. */
export function pageContextMessage(input: PageRender): string {
  const disk: string[] = [];
  if (input.path) disk.push(`Full page on disk: ${input.path}`);
  if (input.logsDir) disk.push(`Full tool outputs: ${input.logsDir}`);
  if (input.path)
    disk.push(
      "When the context tool is available, use context list to find earlier pages, context read with page, kind and offset/limit to inspect a line range, or context search with query to find exact text in archived summaries and transcripts. Otherwise read the page files directly with the available file tools.",
    );
  const footer = disk.length > 0 ? `\n\n${disk.join("\n")}` : "";
  return `${PAGE_HEADER} (older turns were compacted into page ${input.page}):\n\n${renderPage(input)}${footer}`;
}

function messageLine(message: ContextMessage, limit: number): string {
  if (message.role === "user") {
    const title = message.sourceText === undefined ? "Conversation context" : "User message";
    const original =
      message.sourceText !== undefined && message.sourceText !== message.content
        ? `\n\nOriginal user evidence (verbatim):\n${clip(message.sourceText, limit)}`
        : "";
    return `## ${title}\n\n${clip(message.content, limit)}${original}`;
  }
  if (message.role === "assistant") {
    const calls = (message.toolCalls ?? [])
      .map(
        (call) =>
          `### Tool call\n\n- Name: ${markdownValue(call.name)}\n- Tool call identifier: ${markdownValue(call.id ?? "unavailable")}\n\nArguments:\n\n${markdownCode(clip(JSON.stringify(call.args ?? {}), 400), "json")}`,
      )
      .join("\n\n");
    const text = message.content.trim().length > 0 ? clip(message.content, limit) : "";
    return `## Assistant message${text ? `\n\n${text}` : ""}${calls ? `\n\n${calls}` : ""}`;
  }
  const status = message.isError ? "failure" : "success";
  return `## Tool result\n\n- Name: ${markdownValue(message.name)}\n- Status: ${markdownValue(status)}\n- Tool call identifier: ${markdownValue(message.toolCallId)}\n\n${clip(message.content, limit)}`;
}

/** Transcript for the page writer, clipped to a character budget from both ends. */
export function pageTranscript(messages: readonly ContextMessage[], maxChars: number): string {
  const rendered = messages.map((message) => messageLine(message, 6000));
  const total = rendered.reduce((sum, line) => sum + line.length + 2, 0);
  if (total <= maxChars) return rendered.join("\n\n");
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  const headBudget = Math.floor(maxChars * 0.25);
  let index = 0;
  while (index < rendered.length && used + (rendered[index]?.length ?? 0) <= headBudget) {
    head.push(rendered[index] ?? "");
    used += (rendered[index]?.length ?? 0) + 2;
    index += 1;
  }
  let back = rendered.length - 1;
  while (back >= index && used + (rendered[back]?.length ?? 0) <= maxChars) {
    tail.unshift(rendered[back] ?? "");
    used += (rendered[back]?.length ?? 0) + 2;
    back -= 1;
  }
  const omitted = back - index + 1;
  return [...head, `[... ${omitted} messages omitted ...]`, ...tail].join("\n\n");
}
