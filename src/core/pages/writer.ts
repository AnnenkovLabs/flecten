import { z } from "zod";
import pageSummaryPrompt from "../../../prompts/page-summary.md" with { type: "text" };
import type { ContextMessage, ContextSummary, SummarizeContext } from "../../context";
import type { ModelProvider } from "../../providers/types";
import { markdownCode, markdownData } from "../../util/markdown";
import type { ReasoningEffort } from "../types";
import { archiveTranscript, type PageArchive } from "./archive";
import {
  continuationPage,
  originalRequest,
  type PageSummary,
  PageSummaryResponseSchema,
  pageTranscript,
  parsePageSummary,
  renderContinuation,
  renderPage,
} from "./summary";

const MAX_SUMMARY_TOKENS = 4000;
const MODEL_FAILURE_LIMIT = 3;
const CHARS_PER_TOKEN = 3.5;

export interface PageSink {
  /** Saves pages/N.md and returns its path, or undefined when the session has no directory. */
  write(
    page: number,
    markdown: string,
    transcript?: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
  /** Pages already on disk, so numbering continues after a restart. */
  count?(): Promise<number>;
  logsDir?: string | undefined;
  archive?: PageArchive | undefined;
}

export interface PageWriterOptions {
  provider: ModelProvider;
  maxOutputTokens: number;
  contextWindow: number;
  reasoning?: ReasoningEffort | undefined;
  sink?: PageSink | undefined;
  memoryCheckpoint?: PageMemoryCheckpoint | undefined;
}

/** Reuses the existing summary request; the runtime owns evidence checks and persistence. */
export interface PageMemoryCheckpoint {
  schema: z.ZodType;
  instructions: string;
  capture(value: unknown, messages: readonly ContextMessage[]): Promise<void>;
  failed(error: unknown): void;
}

export interface WrittenPage {
  page: number;
  source: "model" | "deterministic";
  path?: string | undefined;
  markdown: string;
  contextSummary: ContextSummary;
}

/**
 * Writes the page summary at a compaction boundary. The worker model writes the five fields;
 * a mechanical check rejects empty fields, and the deterministic page is the fallback.
 * After three model failures in a row the writer stops asking the model.
 */
export class PageWriter {
  #pages = 0;
  #modelFailures = 0;
  readonly #options: PageWriterOptions;
  last: WrittenPage | undefined;
  memoryCheckpoint: PageMemoryCheckpoint | undefined;

  constructor(options: PageWriterOptions, existingPages = 0) {
    this.#options = options;
    this.memoryCheckpoint = options.memoryCheckpoint;
    this.#pages = existingPages;
  }

  get pages(): number {
    return this.#pages;
  }

  get archive(): PageArchive | undefined {
    return this.#options.sink?.archive;
  }

  async write(
    messages: readonly ContextMessage[],
    context: SummarizeContext,
    focus?: string,
  ): Promise<string> {
    context.signal?.throwIfAborted();
    let summary: PageSummary | undefined;
    let source: WrittenPage["source"] = "deterministic";
    if (this.#modelFailures < MODEL_FAILURE_LIMIT && !context.signal?.aborted) {
      summary = await this.#modelSummary(messages, context, focus).catch(() => undefined);
      if (summary) {
        source = "model";
        this.#modelFailures = 0;
      } else {
        this.#modelFailures += 1;
      }
    }
    context.signal?.throwIfAborted();
    const page = this.#pages + 1;
    const savedSummary = continuationPage(messages, context, summary, page);
    const request = originalRequest(messages);
    const markdown = renderPage({ page, summary: savedSummary.fields, request });
    const path = await this.#options.sink?.write(
      page,
      markdown,
      archiveTranscript(page, context.archiveMessages ?? messages),
      context.signal,
    );
    context.signal?.throwIfAborted();
    const pointers = { path, logsDir: this.#options.sink?.logsDir };
    // The sink supplies the actual path. Fit the complete model view after it is known;
    // the page on disk can retain the richer summary saved before the footer was added.
    const contextSummary = continuationPage(messages, context, savedSummary.fields, page, pointers);
    this.#pages = page;
    this.last = { page, source, path, markdown, contextSummary };
    return renderContinuation(contextSummary, pointers);
  }

  async #modelSummary(
    messages: readonly ContextMessage[],
    context: SummarizeContext,
    focus?: string,
  ): Promise<PageSummary | undefined> {
    const outputTokens = Math.max(512, Math.min(MAX_SUMMARY_TOKENS, this.#options.maxOutputTokens));
    const inputTokens = Math.max(2000, this.#options.contextWindow - outputTokens - 2000);
    const transcript = pageTranscript(messages, Math.floor(inputTokens * CHARS_PER_TOKEN * 0.8));
    const focusLine = focus ? `\n\nThe user asked to focus the summary on: ${focus}` : "";
    const checkpoint = this.memoryCheckpoint;
    const responseSchema = checkpoint
      ? PageSummaryResponseSchema.extend({
          memoryCandidates: z.array(checkpoint.schema).max(3).optional(),
        })
      : PageSummaryResponseSchema;
    const memoryInstructions = checkpoint ? `\n\n${checkpoint.instructions}` : "";
    const signal = context.signal ?? new AbortController().signal;
    let text = "";
    for await (const event of this.#options.provider.stream(
      {
        model: this.#options.provider.model,
        system: `${pageSummaryPrompt.trim()}\n\n# Response schema\n\n${markdownCode(JSON.stringify(z.toJSONSchema(responseSchema), null, 2), "json")}${focusLine}${memoryInstructions}`,
        messages: [
          {
            role: "user",
            content: markdownData(
              "Conversation to summarize",
              [["Trust", "untrusted"]],
              transcript,
            ),
          },
        ],
        tools: [],
        maxTokens: outputTokens,
      },
      signal,
    )) {
      if (event.type === "text") text += event.delta;
    }
    if (!checkpoint) return parsePageSummary(text);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const { memoryCandidates, ...fields } = value as Record<string, unknown>;
    const summary = parsePageSummary(JSON.stringify(fields));
    if (!summary || memoryCandidates === undefined) return summary;
    try {
      const candidates = z.array(checkpoint.schema).max(3).parse(memoryCandidates);
      if (candidates.length > 0) await checkpoint.capture(candidates, messages);
    } catch (error) {
      // A failed memory checkpoint must not turn a valid continuation into a fallback page.
      checkpoint.failed(error);
    }
    return summary;
  }
}
