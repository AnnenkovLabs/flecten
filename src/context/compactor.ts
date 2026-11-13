import { markdownExcerpt } from "../util/markdown";
import { estimateMessages, estimateTokens } from "./tokenizer";
import {
  type CompactFailureCode,
  type CompactInput,
  type CompactionState,
  type CompactOutcome,
  type ContextMessage,
  type ContextToolMessage,
  DEFAULT_KEEP_RECENT_TOOL_RESULTS,
  DEFAULT_OLD_TOOL_OUTPUT_TOKENS,
  MAX_CONSECUTIVE_FAILURES,
  PROFILE_4,
  type Summarize,
  type SummarizeContext,
  type TokenEstimate,
  type TokenProfile,
} from "./types";

const HASH_OFFSET = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;
const SUMMARY_OVERHEAD = 4;

const defaultBreakers = new WeakMap<Summarize, CompactionState>();

export function createCompactionState(): CompactionState {
  return { failures: 0, open: false };
}

function defaultState(summarize: Summarize): CompactionState {
  const existing = defaultBreakers.get(summarize);
  if (existing !== undefined) return existing;
  const state = createCompactionState();
  defaultBreakers.set(summarize, state);
  return state;
}

export function prefixHash(system: string, pageSummary: string): string {
  const input = `${system}\u0000${pageSummary}`;
  let hash = HASH_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * HASH_PRIME) & HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function assertStablePrefix(
  expectedHash: string,
  system: string,
  pageSummary: string,
): void {
  const current = prefixHash(system, pageSummary);
  if (current !== expectedHash) {
    throw new Error(`stable prefix changed: expected ${expectedHash}, got ${current}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pageStartIndex(messages: readonly { readonly role: string }[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return 0;
}

function pruneOldToolOutputs(
  messages: readonly ContextMessage[],
  keepRecent: number,
  maxTokens: number,
  profile: TokenProfile,
): { messages: ContextMessage[]; pruned: number } {
  const toolIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "tool") toolIndexes.push(index);
  }

  const keepFrom = Math.max(0, toolIndexes.length - Math.max(0, keepRecent));
  const kept = new Set(toolIndexes.slice(keepFrom));
  const result = messages.slice();
  let pruned = 0;

  for (const index of toolIndexes) {
    const message = result[index];
    if (message?.role !== "tool" || message.isError === true || kept.has(index)) continue;
    if (estimateTokens(message.content, profile).tokens <= maxTokens) continue;

    const maxChars = Math.max(120, Math.floor(maxTokens * profile.charsPerToken));
    const content = markdownExcerpt(
      "Earlier tool result",
      [
        ["Source tool", message.name],
        ["Tool call identifier", message.toolCallId],
        ["Trust", message.name === "skill" ? "project guidance" : "untrusted"],
      ],
      message.content,
      maxChars,
    );
    if (content === message.content) continue;

    const next: ContextToolMessage = { ...message, content };
    result[index] = next;
    pruned += 1;
  }

  return { messages: result, pruned };
}

function totalEstimate(
  system: string,
  messages: readonly ContextMessage[],
  profile: TokenProfile,
  summary?: string,
): TokenEstimate {
  const systemEstimate = estimateTokens(system, profile);
  const messageEstimate = estimateMessages(messages, profile);
  const summaryEstimate = summary === undefined ? undefined : estimateTokens(summary, profile);

  const tokens =
    systemEstimate.tokens +
    messageEstimate.tokens +
    (summaryEstimate?.tokens ?? 0) +
    (summaryEstimate === undefined ? 0 : SUMMARY_OVERHEAD);
  const weighted =
    systemEstimate.tokens * systemEstimate.confidence +
    messageEstimate.tokens * messageEstimate.confidence +
    (summaryEstimate?.tokens ?? 0) * (summaryEstimate?.confidence ?? 0);

  return {
    tokens,
    confidence: tokens > 0 ? Math.round((weighted / tokens) * 100) / 100 : 1,
  };
}

function failed(
  state: CompactionState,
  code: CompactFailureCode,
  message: string,
  countsAsFailure: boolean,
): CompactOutcome {
  if (countsAsFailure) {
    state.failures += 1;
    if (state.failures >= MAX_CONSECUTIVE_FAILURES) state.open = true;
  }
  return {
    ok: false,
    failure: { code, message, attempts: state.failures },
  };
}

export async function compactMessages(
  input: CompactInput,
  state?: CompactionState,
): Promise<CompactOutcome> {
  const breaker = state ?? defaultState(input.summarize);
  const profile = input.profile ?? PROFILE_4;
  const effectiveLimit = input.budget - input.reserve;
  if (!Number.isFinite(effectiveLimit) || effectiveLimit <= 0) {
    return failed(breaker, "invalid_budget", "budget must be greater than reserve", false);
  }
  if (breaker.open) {
    return failed(
      breaker,
      "circuit_open",
      `compaction stopped after ${MAX_CONSECUTIVE_FAILURES} failed attempts`,
      false,
    );
  }
  if (input.signal?.aborted) {
    return failed(breaker, "aborted", "compaction aborted before it started", false);
  }

  const pageStart = clamp(
    input.pageStart ?? pageStartIndex(input.messages),
    0,
    input.messages.length,
  );
  const oldMessages = input.messages.slice(0, pageStart);
  const currentMessages = input.messages.slice(pageStart);
  const before = totalEstimate(input.system, input.messages, profile);

  if (oldMessages.length === 0) {
    return {
      ok: true,
      messages: input.messages.slice(),
      summary: null,
      pruned: 0,
      compacted: false,
      estimated: before,
    };
  }

  const prunedOld = pruneOldToolOutputs(
    oldMessages,
    input.keepRecentToolResults ?? DEFAULT_KEEP_RECENT_TOOL_RESULTS,
    input.oldToolOutputTokens ?? DEFAULT_OLD_TOOL_OUTPUT_TOKENS,
    profile,
  );

  const currentEstimate = estimateMessages(currentMessages, profile);
  const systemEstimate = estimateTokens(input.system, profile);
  const summaryContext: SummarizeContext = {
    profile,
    targetTokens: Math.max(0, effectiveLimit - systemEstimate.tokens - currentEstimate.tokens),
    archiveMessages: oldMessages,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };

  let rawSummary: string;
  try {
    rawSummary = await input.summarize(prunedOld.messages, summaryContext);
  } catch {
    return failed(breaker, "summarize_failed", "summarizer threw during compaction", true);
  }

  if (input.signal?.aborted) {
    return failed(breaker, "aborted", "compaction aborted after summarization", false);
  }

  const summary = rawSummary.trim();
  if (summary.length === 0) {
    return failed(breaker, "summarize_failed", "summarizer returned an empty summary", true);
  }

  const estimated = totalEstimate(input.system, currentMessages, profile, summary);
  if (!input.force && estimated.tokens >= before.tokens) {
    return failed(breaker, "no_reduction", "compaction did not reduce the context", true);
  }

  breaker.failures = 0;
  breaker.open = false;

  return {
    ok: true,
    messages: currentMessages,
    summary,
    pruned: prunedOld.pruned,
    compacted: true,
    estimated,
  };
}
