import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  assertStablePrefix,
  type ContextMessage,
  type ContextSummary,
  compactMessages,
  createCompactionState,
  estimateMessages,
  estimateTokens,
  PROFILE_4,
  pageStartIndex,
  prefixHash,
  type SummarizeContext,
  toolOutputBudget,
  toolOutputClass,
} from "../../context";
import { HarnessError } from "../../errors";
import { markdownExcerpt } from "../../util/markdown";
import { redact } from "../../util/redact";
import { mediaTokens } from "../media";
import { originalContextMessage, rememberContextMessage } from "../memory/context";
import { PageRuntime } from "../pages/runtime";
import { continuationPage, renderContinuation } from "../pages/summary";
import { harnessServices } from "../services/contracts";
import type { Services } from "../services/registry";
import { ServiceMessageSchema } from "../services/validation";
import type { ImagePart, Message } from "../types";
import { eventSchema } from "../types/event-schema";
import type { LoopOptions } from "./types";

const FULL_OUTPUT_MARKER = "[full output: ";
const prefixStates = new WeakMap<Message[], { pageStart: number; hash: string }>();
const budgetedToolMessages = new WeakSet<Message>();

export interface ToolOutputBudgetContext {
  readonly contextWindow: number;
  readonly reserveTokens: number;
  readonly usedTokens: number;
  readonly logDir: string;
}

const contextMedia = new WeakMap<ContextMessage, ImagePart[]>();

function toContextMessages(messages: Message[]): ContextMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") {
      rememberContextMessage(message, message);
      return message;
    }
    const context: ContextMessage = {
      role: "user",
      content: message.content,
      ...(message.memorySource === undefined ? {} : { sourceText: message.memorySource }),
      ...(message.contextSummary ? { contextSummary: message.contextSummary } : {}),
      ...(message.images?.length
        ? { mediaTokens: message.images.reduce((sum, part) => sum + mediaTokens(part), 0) }
        : {}),
    };
    rememberContextMessage(context, message);
    if (message.images?.length) contextMedia.set(context, message.images);
    return context;
  });
}

function estimateContext(
  system: string,
  messages: readonly ContextMessage[],
  toolTokens: number,
): number {
  return (
    estimateMessages(messages, PROFILE_4).tokens +
    estimateTokens(system, PROFILE_4).tokens +
    toolTokens
  );
}

function prefixInput(messages: readonly Message[]): { pageStart: number; prefix: string } {
  const pageStart = pageStartIndex(messages);
  return { pageStart, prefix: JSON.stringify(messages.slice(0, pageStart)) };
}

export function stablePrefixHash(system: string, messages: readonly Message[]): string {
  return prefixHash(system, prefixInput(messages).prefix);
}

function checkStablePrefix(messages: Message[], system: string): void {
  const { pageStart, prefix } = prefixInput(messages);
  const current = stablePrefixHash(system, messages);
  const state = prefixStates.get(messages);
  if (state !== undefined && state.pageStart === pageStart) {
    try {
      assertStablePrefix(state.hash, system, prefix);
    } catch (error) {
      throw new HarnessError(
        "context_overflow",
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }
  if (state === undefined || state.pageStart !== pageStart || state.hash !== current) {
    prefixStates.set(messages, { pageStart, hash: current });
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120) || "call";
}

export async function applyToolOutputBudgets(
  messages: Message[],
  context: ToolOutputBudgetContext,
): Promise<number> {
  const start = pageStartIndex(messages);
  const indexes: number[] = [];
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "tool" || message.isError === true) continue;
    if (budgetedToolMessages.has(message)) continue;
    indexes.push(index);
  }

  let trimmed = 0;
  for (const index of indexes) {
    const message = messages[index];
    if (message?.role !== "tool") continue;
    budgetedToolMessages.add(message);
    const budget = toolOutputBudget(
      { ...context, pendingCalls: indexes.length },
      toolOutputClass(message.name),
    );
    if (estimateTokens(message.content, PROFILE_4).tokens <= budget.tokens) continue;

    let suffix = "";
    if (!message.content.includes(FULL_OUTPUT_MARKER)) {
      const path = join(context.logDir, `${sanitizeId(message.toolCallId)}.log`);
      await mkdir(context.logDir, { recursive: true });
      await Bun.write(path, redact(message.content));
      suffix = `\n\n[full output: ${path}]`;
    }

    const room = Math.max(0, budget.chars - suffix.length);
    const preview = markdownExcerpt(
      "Tool result excerpt",
      [
        ["Source tool", message.name],
        ["Tool call identifier", message.toolCallId],
        ["Trust", message.name === "skill" ? "project guidance" : "untrusted"],
      ],
      message.content,
      room,
    );
    const { memoryReferences: _references, moduleReferences: _modules, ...retained } = message;
    const next: Message = { ...retained, content: `${preview}${suffix}` };
    budgetedToolMessages.add(next);
    messages[index] = next;
    trimmed += 1;
  }
  return trimmed;
}

export interface CompactionRequest {
  focus?: string | undefined;
  /** Checkpoint the whole logical block, including every paired tool result. */
  reason?: "page_checkpoint";
}

export interface CompactionResult {
  compacted: boolean;
  /** Estimated size of the next request after this step. */
  used: number;
  /** Why nothing changed: "nothing_to_compact", "no_reduction" and other breaker codes. */
  reason?: string;
}

/** Share of the window kept verbatim when a single long page has to be cut. */
const DEEP_KEEP_SHARE = 0.25;

/**
 * Cut point inside the current page for ladder step 4. The tail starts at an assistant
 * message, so every kept tool result still follows its call.
 */
export function deepCutIndex(messages: readonly ContextMessage[], keepTokens: number): number {
  let kept = 0;
  let index = messages.length;
  while (index > 1) {
    const message = messages[index - 1];
    if (!message) break;
    const cost = estimateMessages([message], PROFILE_4).tokens;
    if (kept + cost > keepTokens && index < messages.length) break;
    kept += cost;
    index -= 1;
  }
  while (index < messages.length && messages[index]?.role !== "assistant") index += 1;
  return index >= messages.length ? Math.max(1, messages.length - 1) : Math.max(1, index);
}

function fromContextMessages(messages: readonly ContextMessage[]): Message[] {
  return messages.map((message) => {
    const original = originalContextMessage(message);
    if (original?.content === message.content) return { ...original };
    if (message.role === "user") {
      const images = contextMedia.get(message);
      return {
        role: "user",
        content: message.content,
        ...(message.contextSummary ? { contextSummary: message.contextSummary } : {}),
        ...(images ? { images } : {}),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        toolCallId: message.toolCallId,
        name: message.name,
        content: message.content,
        ...(message.isError === undefined ? {} : { isError: message.isError }),
      };
    }
    return {
      role: "assistant",
      content: message.content,
      reasoning: message.reasoning ?? "",
      toolCalls: (message.toolCalls ?? []).map((call) => ({
        id: call.id ?? "",
        name: call.name,
        args: call.args ?? {},
      })),
      ...(message.providerData === undefined ? {} : { providerData: message.providerData }),
    };
  });
}

/** What compaction needs from the loop; the session also uses it to compact while idle. */
export type CompactionOptions = Pick<
  LoopOptions,
  | "system"
  | "tools"
  | "contextWindow"
  | "reserveTokens"
  | "compactionState"
  | "pageWriter"
  | "takeCompactionRequest"
  | "signal"
  | "emit"
  | "hooks"
  | "language"
> & {
  toolContext: {
    logDir: string;
    cwd?: string;
    sessionId?: string;
    services?: Services | undefined;
  };
};

/** Estimated size of the next request: system prompt, tool schemas and history. */
export function contextEstimate(
  system: string,
  messages: Message[],
  tools: LoopOptions["tools"],
): number {
  const toolTokens = estimateTokens(JSON.stringify(tools.specs()), PROFILE_4).tokens;
  return estimateContext(system, toContextMessages(messages), toolTokens);
}

function emitUsage(options: CompactionOptions, used: number): void {
  options.emit({
    type: "context.usage",
    used,
    window: options.contextWindow,
    reserve: options.reserveTokens,
    source: "estimate",
  });
}

/**
 * Compaction ladder from docs/ARCHITECTURE.md section 7:
 * 1. budget each tool result, 2. trim old tool outputs, 3. compact at the page boundary,
 * 4. cut inside a long page and keep the original request verbatim.
 * The breaker in CompactionState stops automatic compaction after three failures in a row.
 */
export async function compactContextIfNeeded(
  messages: Message[],
  options: CompactionOptions,
): Promise<CompactionResult> {
  if (!options.toolContext.services?.has(harnessServices.compact))
    return defaultCompaction(messages, options);
  const result = await options.toolContext.services.invoke(
    harnessServices.compact,
    defaultCompaction,
    messages,
    {
      ...options,
      emit: (event) => {
        eventSchema.parse({ ...event, sessionId: options.toolContext.sessionId ?? "idle" });
        options.emit(event);
      },
    },
  );
  z.array(ServiceMessageSchema).parse(messages);
  z.object({
    compacted: z.boolean(),
    used: z.number().nonnegative(),
    reason: z.string().optional(),
  }).parse(result);
  return result;
}

async function defaultCompaction(
  messages: Message[],
  options: CompactionOptions,
): Promise<CompactionResult> {
  const system = options.system ?? "";
  checkStablePrefix(messages, system);

  const toolTokens = estimateTokens(JSON.stringify(options.tools.specs()), PROFILE_4).tokens;
  const used = estimateContext(system, toContextMessages(messages), toolTokens);
  await applyToolOutputBudgets(messages, {
    contextWindow: options.contextWindow,
    reserveTokens: options.reserveTokens,
    usedTokens: used,
    logDir: options.toolContext.logDir,
  });

  const estimate = estimateContext(system, toContextMessages(messages), toolTokens);
  const limit = options.contextWindow - options.reserveTokens;
  const request = options.takeCompactionRequest?.();
  if (!request && estimate <= limit) {
    emitUsage(options, estimate);
    return { compacted: false, used: estimate };
  }

  const contextMessages = toContextMessages(messages);
  const writer = options.pageWriter;
  const focus =
    request?.focus && options.language
      ? await options.language.input(request.focus)
      : request?.focus;
  let contextSummary: ContextSummary | undefined;
  const activePage = new PageRuntime(messages).active();
  const summaryContext = (context: SummarizeContext): SummarizeContext => ({
    ...context,
    ...(activePage ? { activePage } : {}),
  });
  const summarize = writer
    ? (old: readonly ContextMessage[], context: SummarizeContext) =>
        writer.write(old, summaryContext(context), focus)
    : (old: readonly ContextMessage[], context: SummarizeContext) => {
        contextSummary = continuationPage(old, summaryContext(context));
        return renderContinuation(contextSummary);
      };
  const input = {
    system,
    messages: contextMessages,
    budget: options.contextWindow,
    reserve: options.reserveTokens,
    summarize,
    signal: options.signal,
    ...(request?.reason === "page_checkpoint"
      ? { pageStart: contextMessages.length, force: true }
      : {}),
  };
  // A manual request gets its own breaker: a tiny context that cannot shrink is not a failure,
  // and an open automatic breaker must not block an explicit request.
  const state = request ? createCompactionState() : options.compactionState;
  let outcome = await compactMessages(input, state);
  const tooBig = outcome.ok && estimateWith(outcome, system, toolTokens) > limit;
  if (request?.reason === "page_checkpoint" && tooBig) {
    throw new HarnessError(
      "context_overflow",
      "Logical page summary cannot fit the context window",
    );
  }
  if (request?.reason !== "page_checkpoint" && ((outcome.ok && !outcome.compacted) || tooBig)) {
    const keep = Math.floor(options.contextWindow * DEEP_KEEP_SHARE);
    outcome = await compactMessages(
      { ...input, pageStart: deepCutIndex(contextMessages, keep) },
      state,
    );
  }
  if (!outcome.ok) {
    if (request && estimate <= limit) {
      emitUsage(options, estimate);
      return { compacted: false, used: estimate, reason: outcome.failure.code };
    }
    throw new HarnessError(
      "context_overflow",
      `Context is full and compaction failed (${outcome.failure.code}): ${outcome.failure.message}`,
    );
  }
  if (!outcome.compacted || !outcome.summary) {
    emitUsage(options, estimate);
    return { compacted: false, used: estimate, reason: "nothing_to_compact" };
  }
  const hook = await options.hooks?.run(
    "compact",
    {
      sessionId: options.toolContext.sessionId ?? "idle",
      cwd: options.toolContext.cwd ?? ".",
      compact: {
        summary: outcome.summary,
        reason: request ? "manual" : "auto",
        tokensBefore: estimate,
      },
    },
    options.signal,
  );
  for (const run of hook?.runs ?? []) options.emit({ type: "hook.finished", hook: run });
  if (hook?.blocked) {
    if (estimate > limit)
      throw new HarnessError("context_overflow", hook.reason ?? "Compaction denied by hook");
    emitUsage(options, estimate);
    return { compacted: false, used: estimate, reason: "hook_denied" };
  }
  const kept = fromContextMessages(outcome.messages);
  const summaryText = outcome.summary;
  contextSummary = writer?.last?.contextSummary ?? contextSummary;
  messages.splice(
    0,
    messages.length,
    {
      role: "user",
      content: summaryText,
      ...(contextSummary ? { contextSummary } : {}),
      ...(options.language
        ? { workingLanguage: "en", sourceLanguage: options.language.language }
        : {}),
    },
    ...kept,
  );
  prefixStates.delete(messages);
  checkStablePrefix(messages, system);
  const after = estimateContext(system, toContextMessages(messages), toolTokens);
  const page = writer?.last;
  options.emit({
    type: "context.compacted",
    summary: summaryText,
    ...(options.language ? { displaySummary: await options.language.display(summaryText) } : {}),
    ...(contextSummary ? { contextSummary } : {}),
    pruned: outcome.pruned,
    before: estimate,
    after,
    kept: kept.length,
    ...(page ? { page: page.page, source: page.source } : { source: "deterministic" as const }),
    ...(page?.path ? { path: page.path } : {}),
    ...(request?.focus ? { focus: request.focus } : {}),
  });
  emitUsage(options, after);
  return { compacted: true, used: after };
}

function estimateWith(
  outcome: { readonly messages: readonly ContextMessage[]; readonly summary: string | null },
  system: string,
  toolTokens: number,
): number {
  const summary = outcome.summary ? [{ role: "user" as const, content: outcome.summary }] : [];
  return estimateContext(system, [...summary, ...outcome.messages], toolTokens);
}
