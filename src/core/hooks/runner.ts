import { z } from "zod";
import { hookCanBlock } from "../../../shared/hooks";
import { Mutex } from "../../util/mutex";
import { isSensitiveKey, redactKnown } from "../../util/redact";
import { executeHook } from "./execute";
import { matcherMatches } from "./matcher";
import {
  emptyHookOutcome,
  type HookDefinition,
  type HookInput,
  type HookName,
  type HookOutcome,
  type HookRun,
  type HookRunnerOptions,
  type HooksConfig,
} from "./types";

const MAX_TOTAL_CONTEXT = 32_000;
const MAX_REPORTED_OUTPUT = 4000;

const HookResponseSchema = z
  .object({
    decision: z.enum(["allow", "deny"]).optional(),
    reason: z.string().optional(),
    additionalContext: z.string().optional(),
  })
  .strict();

type ParsedHookResponse = z.infer<typeof HookResponseSchema>;

interface ParsedResponse {
  response: ParsedHookResponse | undefined;
  error: string | undefined;
}

interface Completed {
  run: HookRun;
  blocked: boolean;
  reason: string | undefined;
  context: string[];
}

function parseResponse(stdout: string): ParsedResponse {
  const text = stdout.trim();
  if (text.length === 0) return { response: undefined, error: undefined };
  try {
    const parsed = HookResponseSchema.safeParse(JSON.parse(text));
    if (parsed.success) return { response: parsed.data, error: undefined };
    return {
      response: undefined,
      error: `invalid hook response: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
    };
  } catch (error) {
    return {
      response: undefined,
      error: `invalid hook JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function scrub(text: string, hook: HookDefinition): string {
  return redactKnown(text, [
    ...Object.entries(hook.env ?? {})
      .filter(([key]) => isSensitiveKey(key))
      .map(([, value]) => value),
    ...Object.values(hook.headers ?? {}),
  ]);
}

function identity(hook: HookDefinition): Pick<HookRun, "id" | "name" | "source"> {
  return {
    ...(hook.id ? { id: hook.id } : {}),
    ...(hook.source ? { source: hook.source } : {}),
    ...(hook.name ? { name: scrub(hook.name, hook) } : {}),
  };
}

function reportedOutput(
  captured: { stdout: string; stderr: string },
  hook: HookDefinition,
): { output: string | undefined; truncated: boolean } {
  const value = scrub(captured.stderr.trim() || captured.stdout.trim(), hook);
  return {
    output: value.length > 0 ? value.slice(0, MAX_REPORTED_OUTPUT) : undefined,
    truncated: value.length > MAX_REPORTED_OUTPUT,
  };
}

function strictReason(event: HookName, failure: string): string {
  return `Hook ${event} failed closed: ${failure}`;
}

function failureRun(
  hook: HookDefinition,
  event: HookName,
  index: number,
  started: number,
  strict: boolean,
  message: string,
  isAsync = false,
  canBlock = hookCanBlock(event),
): Completed {
  const error = scrub(message, hook).slice(0, MAX_REPORTED_OUTPUT);
  const blocked = strict && canBlock;
  return {
    run: {
      event,
      index,
      ...identity(hook),
      ok: false,
      blocked,
      durationMs: Math.round(performance.now() - started),
      error,
      ...(isAsync ? { async: true } : {}),
    },
    blocked,
    reason: blocked ? strictReason(event, error) : undefined,
    context: [],
  };
}

async function runOne(
  hook: HookDefinition,
  event: HookName,
  index: number,
  input: HookInput,
  signal: AbortSignal,
  strict: boolean,
  isAsync = false,
): Promise<Completed> {
  const canBlock =
    hookCanBlock(event) && !(event === "subagent" && input.subagent?.phase === "stop");
  const started = performance.now();
  const captured = await executeHook(hook, event, input, input.cwd, signal);
  const parsed =
    hook.responseFormat === "text"
      ? { response: undefined, error: undefined }
      : parseResponse(captured.stdout);

  const deliberateDeny =
    captured.exitCode === 2 &&
    !captured.timedOut &&
    !captured.aborted &&
    captured.error === undefined;
  const failure =
    captured.error ??
    (captured.timedOut
      ? "hook timed out"
      : captured.aborted
        ? "hook aborted"
        : captured.exitCode !== 0 && !deliberateDeny
          ? `hook exited with code ${captured.exitCode}`
          : parsed.error);

  const response = failure === undefined ? parsed.response : undefined;
  const deny = deliberateDeny || response?.decision === "deny";
  const denied = deny && canBlock;
  const strictBlocked = strict && failure !== undefined && canBlock && !denied;
  const blocked = denied || strictBlocked;

  let reason: string | undefined;
  if (denied) {
    reason =
      response?.reason?.trim() || captured.stderr.trim() || `Hook ${event} denied the operation`;
  } else if (strictBlocked) {
    reason = strictReason(event, failure ?? "unknown failure");
  }

  const preview = reportedOutput(captured, hook);
  const error = failure ?? (blocked ? "hook denied the operation" : undefined);
  const run: HookRun = {
    event,
    index,
    ...identity(hook),
    ok: failure === undefined && !blocked,
    blocked,
    ...(response?.decision ? { decision: response.decision } : {}),
    durationMs: Math.round(performance.now() - started),
    exitCode: captured.exitCode,
    timedOut: captured.timedOut,
    aborted: captured.aborted,
    outputTruncated: captured.outputTruncated || preview.truncated,
    ...(preview.output ? { output: preview.output } : {}),
    ...(error ? { error: scrub(error, hook).slice(0, MAX_REPORTED_OUTPUT) } : {}),
    ...(isAsync ? { async: true } : {}),
  };

  return {
    run,
    blocked,
    reason: reason ? scrub(reason, hook).slice(0, MAX_REPORTED_OUTPUT) : undefined,
    context: response?.additionalContext ? [scrub(response.additionalContext, hook)] : [],
  };
}

export interface HookRunner {
  run(event: HookName, input: HookInput, signal: AbortSignal): Promise<HookOutcome>;
}

export function createHookRunner(
  config: HooksConfig | (() => HooksConfig),
  options: HookRunnerOptions = {},
): HookRunner {
  const mutex = new Mutex();

  return {
    run(event, input, signal): Promise<HookOutcome> {
      const dispatch = async (): Promise<HookOutcome> => {
        const current = typeof config === "function" ? config() : config;
        const hooks = [...(current[event] ?? []).entries()].filter(
          ([, hook]) => hook.enabled !== false && matcherMatches(hook, input),
        );
        if (hooks.length === 0) return emptyHookOutcome();

        const combined = emptyHookOutcome();
        let contextChars = 0;
        const appendContext = (texts: string[]): void => {
          for (const text of texts) {
            if (contextChars >= MAX_TOTAL_CONTEXT) return;
            const remaining = MAX_TOTAL_CONTEXT - contextChars;
            const slice = text.slice(0, remaining);
            if (slice.length === 0) continue;
            combined.context.push(slice);
            contextChars += slice.length;
          }
        };

        const canBlock =
          hookCanBlock(event) && !(event === "subagent" && input.subagent?.phase === "stop");
        for (const [index, hook] of hooks) {
          const started = performance.now();
          const failClosed = hook.failClosed === true;

          if (hook.async === true && !canBlock) {
            // ponytail: async hooks escape the event mutex; add per-hook queues if file races matter.
            void runOne(hook, event, index, input, signal, failClosed, true)
              .then((completed) => options.onRun?.(completed.run))
              .catch((error) => {
                options.onRun?.(
                  failureRun(
                    hook,
                    event,
                    index,
                    started,
                    failClosed,
                    error instanceof Error ? error.message : String(error),
                    true,
                    canBlock,
                  ).run,
                );
              });
            continue;
          }

          let completed: Completed;
          try {
            completed = await runOne(hook, event, index, input, signal, failClosed);
          } catch (error) {
            completed = failureRun(
              hook,
              event,
              index,
              started,
              failClosed,
              error instanceof Error ? error.message : String(error),
              false,
              canBlock,
            );
          }
          combined.runs.push(completed.run);
          appendContext(completed.context);
          if (completed.blocked) {
            combined.blocked = true;
            if (completed.reason) combined.reason = completed.reason;
            break;
          }
        }
        return combined;
      };
      let running: Promise<HookOutcome> | undefined;
      return mutex
        .run(() => {
          running = dispatch();
          return running;
        }, signal)
        .catch((error: unknown) => {
          if (signal.aborted) return running ?? dispatch();
          throw error;
        });
    },
  };
}
