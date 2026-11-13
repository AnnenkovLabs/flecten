export interface TokenProfile {
  readonly id: string;
  readonly charsPerToken: number;
}

export const TOKEN_PROFILES = {
  char4: { id: "char4", charsPerToken: 4 },
  char3: { id: "char3", charsPerToken: 3 },
} as const satisfies Record<string, TokenProfile>;

export const PROFILE_4 = TOKEN_PROFILES.char4;
export const PROFILE_3 = TOKEN_PROFILES.char3;

export interface TokenEstimate {
  readonly tokens: number;
  readonly confidence: number;
}

export interface ContextToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args?: unknown;
}

/** Structured continuation state. Markdown is a view, never a source for resummarization. */
export interface ContextSummary {
  readonly page: number;
  readonly fields: Record<"changed" | "where" | "rules" | "next" | "risks", string>;
  readonly originalRequest?: string;
  readonly latestRequest?: string;
  /** An unfinished semantic block survives an emergency context-window checkpoint. */
  readonly activePage?: { readonly title: string; readonly objective: string };
}

export interface ContextUserMessage {
  /** Exact human input when different from the model-facing translation or enriched prompt. */
  readonly sourceText?: string;
  readonly role: "user";
  readonly content: string;
  readonly contextSummary?: ContextSummary;
  readonly images?: number;
  readonly mediaTokens?: number;
}

export interface ContextAssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly ContextToolCall[];
  readonly providerData?: unknown;
  readonly images?: number;
}

export interface ContextToolMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
  readonly images?: number;
}

export type ContextMessage = ContextUserMessage | ContextAssistantMessage | ContextToolMessage;

export interface SummarizeContext {
  readonly profile: TokenProfile;
  readonly targetTokens: number;
  readonly signal?: AbortSignal;
  /** Full span before summary-only pruning, for lossless session archives. */
  readonly archiveMessages?: readonly ContextMessage[];
  readonly activePage?: ContextSummary["activePage"];
}

export type Summarize = (
  oldMessages: readonly ContextMessage[],
  context: SummarizeContext,
) => string | Promise<string>;

export interface CompactInput {
  readonly system: string;
  readonly messages: readonly ContextMessage[];
  readonly budget: number;
  readonly reserve: number;
  readonly summarize: Summarize;
  readonly profile?: TokenProfile;
  readonly pageStart?: number;
  readonly keepRecentToolResults?: number;
  readonly oldToolOutputTokens?: number;
  readonly signal?: AbortSignal;
  /** A completed semantic page is checkpointed even when its short summary is larger. */
  readonly force?: boolean;
}

export interface CompactResult {
  readonly messages: ContextMessage[];
  readonly summary: string | null;
  readonly pruned: number;
  readonly compacted: boolean;
  readonly estimated: TokenEstimate;
}

export type CompactFailureCode =
  | "circuit_open"
  | "summarize_failed"
  | "no_reduction"
  | "aborted"
  | "invalid_budget";

export interface CompactFailure {
  readonly code: CompactFailureCode;
  readonly message: string;
  readonly attempts: number;
}

export type CompactOutcome =
  | ({ readonly ok: true } & CompactResult)
  | { readonly ok: false; readonly failure: CompactFailure };

export interface CompactionState {
  failures: number;
  open: boolean;
}

export const MAX_CONSECUTIVE_FAILURES = 3;
export const DEFAULT_KEEP_RECENT_TOOL_RESULTS = 3;
export const DEFAULT_OLD_TOOL_OUTPUT_TOKENS = 400;
