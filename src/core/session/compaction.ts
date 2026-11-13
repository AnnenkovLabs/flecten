import { type CompactionState, createCompactionState } from "../../context";
import type { PromptTextPart } from "../../context/prompt-budget";
import type { ModelProvider } from "../../providers/types";
import type { PermissionEngine } from "../../security/permissions";
import type { SandboxPolicy } from "../../security/sandbox";
import type { ToolRegistry } from "../../tools/registry";
import { type LanguageOptions, LanguageRun } from "../../translation/run";
import { createHookRunner } from "../hooks/runner";
import type { HooksConfig } from "../hooks/types";
import {
  type CompactionRequest,
  type CompactionResult,
  compactContextIfNeeded,
  contextEstimate,
} from "../loop/context";
import type { LoopEvent } from "../loop/types";
import type { MemoryPort } from "../memory/types";
import { type PageMemoryCheckpoint, type PageSink, PageWriter } from "../pages/writer";
import type { Message, SessionId } from "../types";
import { sessionMemory } from "./memory";

export interface ContextReading {
  used: number;
  window: number;
  reserve: number;
  source: "estimate" | "provider";
}

/** Live session settings; the session passes its own options object, so updates apply. */
export interface SessionCompactionOptions {
  readonly modules?: import("../modules/types").ModuleSessionPort;
  readonly cwd?: string;
  readonly hooks?: HooksConfig;
  readonly provider: ModelProvider;
  readonly maxOutputTokens: number;
  readonly context: { window: number; reserve: number };
  readonly system: string;
  readonly systemParts?: readonly PromptTextPart[];
  readonly language?: LanguageOptions | undefined;
  readonly tools: ToolRegistry;
  readonly memory?: MemoryPort;
  readonly permissions?: PermissionEngine;
  readonly sandbox?: SandboxPolicy | undefined;
  secrets?(): readonly string[];
  pages?(sessionId: SessionId): PageSink;
  logDir(sessionId: string): string;
}

/**
 * Pages, manual compaction requests and the last context reading of one session handle.
 * A request made during a run is applied before the next model request; an idle session
 * compacts at once.
 */
export class SessionCompaction {
  readonly state: CompactionState = createCompactionState();
  readonly #options: SessionCompactionOptions;
  readonly #writers = new Map<SessionId, PageWriter>();
  #request: CompactionRequest | undefined;
  #reading: { sessionId: SessionId; value: ContextReading } | undefined;
  #idle: Promise<void> | undefined;

  constructor(options: SessionCompactionOptions) {
    this.#options = options;
  }

  async writer(sessionId: SessionId, memoryCheckpoint?: PageMemoryCheckpoint): Promise<PageWriter> {
    const known = this.#writers.get(sessionId);
    if (known) {
      known.memoryCheckpoint = memoryCheckpoint;
      return known;
    }
    const options = this.#options;
    const sink = options.pages?.(sessionId);
    const existing = (await sink?.count?.()) ?? 0;
    const writer = new PageWriter(
      {
        get provider() {
          return options.provider;
        },
        get maxOutputTokens() {
          return options.maxOutputTokens;
        },
        get contextWindow() {
          return options.context.window;
        },
        sink,
      },
      existing,
    );
    writer.memoryCheckpoint = memoryCheckpoint;
    this.#writers.set(sessionId, writer);
    return writer;
  }

  schedule(request: CompactionRequest): void {
    this.#request = request;
  }

  readonly take = (): CompactionRequest | undefined => {
    const request = this.#request;
    this.#request = undefined;
    return request;
  };

  note(sessionId: SessionId, event: LoopEvent): void {
    if (event.type !== "context.usage") return;
    const { used, window, reserve, source } = event;
    this.#reading = { sessionId, value: { used, window, reserve, source } };
  }

  reading(sessionId: SessionId | undefined, history: Message[]): ContextReading | undefined {
    if (sessionId === undefined) return undefined;
    if (this.#reading?.sessionId === sessionId) return this.#reading.value;
    if (history.length === 0) return undefined;
    const { system, tools, context } = this.#options;
    const used = contextEstimate(system, history, tools);
    return { used, window: context.window, reserve: context.reserve, source: "estimate" };
  }

  async compactIdle(
    sessionId: SessionId,
    history: Message[],
    request: CompactionRequest,
    emit: (event: LoopEvent) => void,
  ): Promise<CompactionResult> {
    const options = this.#options;
    let once: CompactionRequest | undefined = request;
    const run = (async () => {
      const signal = new AbortController().signal;
      await options.modules?.prepare(sessionId, history, signal);
      const selected = options.language;
      const language =
        selected &&
        new LanguageRun(
          selected,
          signal,
          ({ usage, durationMs }) =>
            emit({
              type: "usage",
              usage,
              purpose: "translation",
              provider: selected.providerId,
              model: selected.client.provider.model,
              durationMs,
            }),
          () =>
            emit({
              type: "translation.failed",
              message: "Не удалось перевести саммари. Показан английский оригинал.",
            }),
        );
      if (language) await language.prepare("", "", history, true);
      const system = language
        ? await language.system(options.system, options.systemParts)
        : options.system;
      const memory = options.cwd
        ? sessionMemory({ ...options, cwd: options.cwd }, sessionId, system, history)
        : undefined;
      const pageWriter = await this.writer(sessionId, memory?.checkpoint());
      const result = await compactContextIfNeeded(history, {
        language,
        ...(options.hooks ? { hooks: createHookRunner(options.hooks) } : {}),
        system,
        tools: options.tools,
        contextWindow: options.context.window,
        reserveTokens: options.context.reserve,
        compactionState: this.state,
        pageWriter,
        takeCompactionRequest: () => {
          const next = once;
          once = undefined;
          return next;
        },
        signal,
        emit: (event) => {
          this.note(sessionId, event);
          emit(event);
        },
        toolContext: {
          services: options.modules?.services?.(sessionId),
          logDir: options.logDir(sessionId),
          sessionId,
          ...(options.cwd ? { cwd: options.cwd } : {}),
        },
      });
      const notice = memory?.takeNotice();
      if (notice) {
        history.push({ role: "user", content: notice.text, memoryReferences: notice.references });
        emit({ type: "memory.context", ...notice });
      }
      return result;
    })();
    this.#idle = run.then(() => undefined);
    try {
      return await run;
    } finally {
      this.#idle = undefined;
    }
  }

  /** Waits for an idle compaction so a new run never sees half-replaced history. */
  async settled(): Promise<void> {
    await this.#idle?.catch(() => undefined);
  }
}
