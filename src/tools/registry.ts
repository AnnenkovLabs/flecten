import { harnessServices } from "../core/services/contracts";
import { ServiceToolResultSchema } from "../core/services/validation";
import type { ToolCall, ToolResult } from "../core/types";
import { isObject } from "../util/json";
import { ToolExecutionDeadline } from "./execution-deadline";
import { writeToolLog } from "./logs";
import { repairToolInput, resolveToolAlias } from "./repair";
import {
  isToolFailureKind,
  type Tool,
  type ToolContext,
  ToolFailure,
  type ToolFailureKind,
  type ToolLimits,
  type ToolSource,
} from "./types";

export interface ToolRegistryOptions {
  limits: ToolLimits;
  authorize?(tool: Tool, context: ToolContext): string | undefined;
}

export const TOOL_RETRY_ATTEMPTS = 3;
export const TOOL_RETRY_MUTATING_ATTEMPTS = 2;
export const TOOL_RETRY_BASE_MS = 50;
export const TOOL_RETRY_MAX_MS = 400;
const JITTER_RATIO = 0.25;

type PreparedInput = { tool: Tool; input: Record<string, unknown>; notes: string[] };
export type PreparedCall = { call: ToolCall; error?: never } | { error: ToolResult; call?: never };

function freezeInput(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeInput(child);
  Object.freeze(value);
}

export function toolRetryDelay(attempt: number, random: number = Math.random()): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(TOOL_RETRY_MAX_MS, TOOL_RETRY_BASE_MS * 2 ** exponent);
  const jitter = base * JITTER_RATIO * Math.min(1, Math.max(0, random));
  return Math.min(TOOL_RETRY_MAX_MS, Math.round(base + jitter));
}

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function thrownFailureKind(error: unknown): ToolFailureKind | undefined {
  if (error instanceof ToolFailure) return error.kind;
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && TRANSIENT_ERROR_CODES.has(code) ? "transient" : undefined;
}

function resultFailureKind(result: ToolResult): ToolFailureKind | undefined {
  if (result.ok || !isObject(result.data)) return undefined;
  const data = result.data;
  if (isToolFailureKind(data.errorKind)) return data.errorKind;
  if (isToolFailureKind(data.kind)) return data.kind;
  if (data.timedOut === true) return "timeout";
  if (data.aborted === true) return "aborted";
  if (data.kind === "sandbox" || data.kind === "approval" || data.kind === "hook") {
    return "permission";
  }
  const status = data.status;
  if (typeof status !== "number") return undefined;
  if (status >= 500 && status <= 599) return "transient";
  if (status >= 400 && status <= 499) return "client";
  return undefined;
}

function retryAttempts(tool: Tool, call: ToolCall): number {
  if (!tool.mutating) return TOOL_RETRY_ATTEMPTS;
  const key = call.idempotencyKey;
  return typeof key === "string" && key.length > 0 ? TOOL_RETRY_MUTATING_ATTEMPTS : 1;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortedResult(result: ToolResult): ToolResult {
  return {
    ok: false,
    output: result.output,
    error: "Tool aborted",
    data: { errorKind: "aborted" },
  };
}

export class ToolRegistry {
  readonly #tools = new Map<string, Tool>();
  readonly #prepared = new WeakMap<ToolCall, PreparedInput>();
  #limits: ToolLimits;
  readonly #authorize: ToolRegistryOptions["authorize"];

  constructor(tools: Tool[], options: ToolRegistryOptions) {
    this.#limits = options.limits;
    this.#authorize = options.authorize;
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) {
        throw new Error(`tool already registered: ${tool.name}`);
      }
      // A catalog may customize metadata without changing another registry's definition.
      this.#tools.set(tool.name, { ...tool });
    }
  }

  setLimits(limits: ToolLimits): void {
    this.#limits = limits;
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name);
  }

  isMutating(name: string): boolean {
    return this.#tools.get(name)?.mutating ?? false;
  }

  source(name: string): ToolSource {
    return this.#tools.get(name)?.source ?? "builtin";
  }

  canonicalName(name: string): string {
    return resolveToolAlias(name, new Set(this.#tools.keys())).name;
  }

  list(): Tool[] {
    return [...this.#tools.values()];
  }

  authorize(name: string, context: ToolContext): string | undefined {
    const tool = this.#tools.get(this.canonicalName(name));
    return tool ? this.#authorize?.(tool, context) : `Unknown tool: ${name}`;
  }

  specs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /** Repair and validate once, before hooks and authorization see the executable arguments. */
  prepare(call: ToolCall): PreparedCall {
    if (this.#prepared.has(call)) return { call };
    const alias = resolveToolAlias(call.name, new Set(this.#tools.keys()));
    const tool = this.#tools.get(alias.name);
    if (!tool) {
      return {
        error: {
          ok: false,
          output: "",
          error: `Unknown tool: ${call.name}. Available tools: ${[...this.#tools.keys()].join(", ")}`,
        },
      };
    }
    const repaired = repairToolInput(tool, structuredClone(call.args));
    if (repaired.correction) {
      return {
        error: { ok: false, output: "", error: repaired.correction, durationMs: 0 },
      };
    }
    // Use schema output too: defaults and transforms are part of the operation being authorized.
    const parsed = tool.schema.safeParse(repaired.input);
    if (!parsed.success || !isObject(parsed.data)) {
      return { error: { ok: false, output: "", error: "Tool arguments must produce an object" } };
    }
    freezeInput(parsed.data);
    const normalized = Object.freeze({ ...call, name: alias.name, args: parsed.data });
    const notes = [
      ...(alias.note ? [alias.note] : []),
      ...repaired.notes.map((entry) => `Input repair: ${entry}`),
    ];
    this.#prepared.set(normalized, { tool, input: parsed.data, notes });
    return { call: normalized };
  }

  async run(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const prepared = this.prepare(call);
    if (prepared.error) return prepared.error;
    call = prepared.call;
    const entry = this.#prepared.get(call);
    if (!entry) throw new Error("Prepared tool call is missing its input");
    const { tool, input, notes } = entry;
    const denied = this.#authorize?.(tool, context);
    if (denied) return { ok: false, output: "", error: denied, data: { kind: "permission" } };
    const started = performance.now();
    const maxAttempts = retryAttempts(tool, call);
    let result: ToolResult = { ok: false, output: "", error: "tool did not run" };

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result = await this.#executeOnce(tool, input, { ...context, callId: call.id });
      if (result.ok || attempt === maxAttempts) break;
      if (context.signal.aborted) {
        result = abortedResult(result);
        break;
      }
      if (resultFailureKind(result) !== "transient") break;
      if (!(await waitForRetry(toolRetryDelay(attempt), context.signal))) {
        result = abortedResult(result);
        break;
      }
    }

    if (context.signal.aborted && !result.ok) result = abortedResult(result);

    const durationMs = Math.round(performance.now() - started);
    const log = await writeToolLog({
      toolName: tool.name,
      callId: call.id,
      text: result.output,
      logDir: context.logDir,
      limits: this.#limits,
      ...(result.fullOutputPath ? { existingPath: result.fullOutputPath } : {}),
      ...(context.secrets ? { secrets: context.secrets } : {}),
    });
    const trailer = [result.trailer, `[full output: ${log.path}]`]
      .filter((line) => line !== undefined && line.length > 0)
      .join("\n");
    const notice = [notes.join("\n"), result.notice]
      .filter((line) => line !== undefined && line.length > 0)
      .join("\n");
    const provenance = result.provenance ?? tool.provenance?.(input);
    let data = result.data;
    if (
      log.excerpt !== result.output &&
      (tool.name === "memory" || tool.name === "done" || tool.name === "module") &&
      isObject(data)
    ) {
      const { memoryReferences: _references, moduleReferences: _modules, ...retained } = data;
      data = retained;
    }
    return {
      ...result,
      output: log.excerpt,
      data,
      ...(provenance ? { provenance } : {}),
      ...(notice.length > 0 ? { notice } : {}),
      trailer,
      fullOutputPath: log.path,
      durationMs,
    };
  }

  async #executeOnce(tool: Tool, input: unknown, context: ToolContext): Promise<ToolResult> {
    const budget = tool.timeoutMs?.(input) ?? this.#limits.bashTimeoutMs + 30_000;
    const timeout = new ToolExecutionDeadline(
      context.signal,
      budget > 0 ? budget : this.#limits.bashTimeoutMs + 30_000,
    );

    try {
      const scoped = timeout.scope(context);
      const execution = context.services
        ? context.services
            .invoke(
              harnessServices.tool,
              (tool, input, current) => tool.execute(input, current),
              tool,
              input,
              scoped,
            )
            .then((result) => {
              ServiceToolResultSchema.parse(result);
              return result;
            })
        : tool.execute(input, scoped);
      // ponytail: a timed-out mutation may still finish in the background; tools that matter observe the signal.
      execution.catch(() => undefined);
      const expired = new Promise<ToolResult>((resolve) => {
        const onAbort = () =>
          resolve({
            ok: false,
            output: "",
            error: context.signal.aborted
              ? "Tool aborted"
              : `Tool timed out after ${Math.round(budget / 1000)}s`,
            data: { errorKind: context.signal.aborted ? "aborted" : "timeout" },
          });
        if (timeout.signal.aborted) onAbort();
        else timeout.signal.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([execution, expired]);
    } catch (error) {
      const kind = thrownFailureKind(error);
      return {
        ok: false,
        output: "",
        error: errorMessage(error),
        ...(kind ? { data: { errorKind: kind } } : {}),
      };
    } finally {
      timeout.cancel();
    }
  }
}
