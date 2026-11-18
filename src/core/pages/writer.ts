import { z } from "zod";
import pageSummaryPrompt from "../../../prompts/page-summary.md" with { type: "text" };
import type { ContextMessage, ContextSummary, SummarizeContext } from "../../context";
import { responseOfError } from "../../providers/response";
import type { ModelProvider } from "../../providers/types";
import { markdownCode, markdownData } from "../../util/markdown";
import type { LoopEvent } from "../loop/types";
import type { ReasoningEffort } from "../types";
import { archiveTranscript, type PageArchive } from "./archive";
import {
  completedPageReport,
  continuationPage,
  deterministicPage,
  originalRequest,
  type PageSummary,
  PageSummaryResponseSchema,
  parsePageSummary,
  renderContinuation,
  renderPage,
  stripJsonFence,
} from "./summary";
import { pageTranscript } from "./transcript";

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
  onEvent: ((event: LoopEvent) => void) | undefined;
  #pages = 0;
  #modelFailures = 0;
  #schemaFailure = "summary_schema_invalid";
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
    const completed = completedPageReport(messages);
    let summary: PageSummary | undefined = completed ? deterministicPage(messages) : undefined;
    let source: WrittenPage["source"] = "deterministic";
    if (!completed && this.#modelFailures < MODEL_FAILURE_LIMIT && !context.signal?.aborted) {
      let providerFailed = false;
      this.#schemaFailure = "summary_schema_invalid";
      summary = await this.#modelSummary(messages, context, focus).catch((error: unknown) => {
        providerFailed = true;
        const response = responseOfError(error);
        this.onEvent?.({
          type: "context.summary.failed",
          stage: "provider",
          reason: response?.outcome ?? (error instanceof Error ? error.name : "unknown_error"),
        });
        return undefined;
      });
      if (summary) {
        source = "model";
        this.#modelFailures = 0;
      } else {
        this.#modelFailures += 1;
        if (!providerFailed)
          this.onEvent?.({
            type: "context.summary.failed",
            stage: "schema",
            reason: this.#schemaFailure,
          });
        if (this.#modelFailures === MODEL_FAILURE_LIMIT)
          this.onEvent?.({
            type: "context.summary.failed",
            stage: "disabled",
            reason: "summary_failure_limit_reached",
          });
      }
    }
    context.signal?.throwIfAborted();
    const page = this.#pages + 1;
    const fields = summary ?? deterministicPage(messages);
    const request = originalRequest(messages);
    const markdown = renderPage({ page, summary: fields, request });
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
    const contextSummary = continuationPage(messages, context, fields, page, pointers);
    this.#pages = page;
    this.last = { page, source, path, markdown, contextSummary };
    return renderContinuation(contextSummary, pointers);
  }

  #parseSummary(text: string): PageSummary | undefined {
    const result = parsePageSummary(text);
    if (result) return result;
    try {
      const parsed = PageSummaryResponseSchema.safeParse(JSON.parse(stripJsonFence(text)));
      this.#schemaFailure = parsed.success
        ? "summary_schema_invalid"
        : parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "response"}:${issue.code}`)
            .join(", ");
    } catch {
      this.#schemaFailure = "summary_json_invalid";
    }
    return undefined;
  }

  async #modelSummary(
    messages: readonly ContextMessage[],
    context: SummarizeContext,
    focus?: string,
  ): Promise<PageSummary | undefined> {
    const outputTokens = Math.max(512, Math.min(MAX_SUMMARY_TOKENS, this.#options.maxOutputTokens));
    const inputTokens = Math.max(
      2000,
      Math.min(32_000, this.#options.contextWindow - outputTokens - 2000),
    );
    const transcript = pageTranscript(messages, Math.floor(inputTokens * CHARS_PER_TOKEN * 0.8));
    const focusLine = focus ? `\n\nThe user asked to focus the summary on: ${focus}` : "";
    const checkpoint = this.memoryCheckpoint;
    const responseSchema = checkpoint
      ? PageSummaryResponseSchema.extend({
          memoryCandidates: z.array(checkpoint.schema).max(3).optional(),
        })
      : PageSummaryResponseSchema;
    const memoryInstructions = checkpoint ? `\n\n${checkpoint.instructions}` : "";
    const signal = AbortSignal.any([
      context.signal ?? new AbortController().signal,
      AbortSignal.timeout(120_000),
    ]);
    let text = "";
    let usageReported = false;
    let responseReported = false;
    let missingReported = false;
    const receipts = new Set<string>();
    let route: { provider?: string; model: string } = { model: this.#options.provider.model };
    const recordResponse = (response: import("../../providers/response").ProviderResponse) => {
      const key = response.attemptId ?? response.requestId ?? "unidentified";
      if (receipts.has(key)) return;
      receipts.add(key);
      responseReported = true;
      this.onEvent?.({ type: "provider.response", response });
      if (response.usage === "missing" && response.requested !== false) {
        const provider = response.provider ?? route.provider;
        this.onEvent?.({
          type: "usage.unavailable",
          purpose: "compaction",
          ...(provider ? { provider } : {}),
          model: response.model ?? route.model,
        });
        missingReported = true;
      }
    };
    try {
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
          ...(this.#options.reasoning ? { reasoning: this.#options.reasoning } : {}),
        },
        signal,
      )) {
        if (event.type === "text") text += event.delta;
        else if (event.type === "usage") {
          usageReported = true;
          this.onEvent?.({
            type: "usage",
            usage: {
              input: event.input,
              output: event.output,
              cached: event.cached,
              ...(event.reasoning === undefined ? {} : { reasoning: event.reasoning }),
              ...(event.cacheWrite === undefined ? {} : { cacheWrite: event.cacheWrite }),
            },
            purpose: "compaction",
            ...(event.provider
              ? { provider: event.provider }
              : route.provider
                ? { provider: route.provider }
                : {}),
            model: event.model ?? route.model,
          });
        } else if (event.type === "route") route = { provider: event.provider, model: event.model };
        else if (event.type === "response") {
          recordResponse(event.response);
        } else if (event.type === "done" && event.response) {
          recordResponse(event.response);
        }
      }
    } catch (error) {
      const response = responseOfError(error);
      if (response && !responseReported) recordResponse(response);
      throw error;
    } finally {
      if (!usageReported && !missingReported && !responseReported)
        this.onEvent?.({ type: "usage.unavailable", purpose: "compaction", ...route });
    }
    if (!checkpoint) return this.#parseSummary(text);
    let value: unknown;
    try {
      value = JSON.parse(stripJsonFence(text));
    } catch {
      this.#schemaFailure = "summary_json_invalid";
      return undefined;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const { memoryCandidates, ...fields } = value as Record<string, unknown>;
    const summary = this.#parseSummary(JSON.stringify(fields));
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
