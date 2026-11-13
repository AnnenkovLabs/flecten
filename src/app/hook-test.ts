import { z } from "zod";
import {
  HOOK_NAMES,
  HookDefinitionSchema,
  type HookSample,
  HookSampleSchema,
  type HookTestResult,
} from "../../shared/hooks";
import type { HarnessConfig } from "../config/schema";
import { matcherMatches } from "../core/hooks/matcher";
import { createHookRunner } from "../core/hooks/runner";
import type { HookInput, HookName } from "../core/hooks/types";

const Input = z
  .object({
    event: z.enum(HOOK_NAMES),
    index: z.number().int().nonnegative().optional(),
    hook: HookDefinitionSchema.optional(),
    sample: HookSampleSchema.optional(),
    // Existing bridge callers can still test a saved hook by index and tool name.
    toolName: z.string().min(1).max(128).optional(),
  })
  .refine((input) => input.hook !== undefined || input.index !== undefined, {
    message: "Provide a draft hook or the index of a saved hook",
  });

/** Build only the payload emitted by this event, so conditions see realistic data. */
function sampleInput(event: HookName, cwd: string, sample: HookSample): HookInput {
  const base = { sessionId: "s_hook-test", cwd };
  const toolName = sample.toolName ?? "read";
  const toolArgs = {
    ...(sample.path ? { path: sample.path } : {}),
    ...(sample.command ? { command: sample.command } : {}),
  };
  switch (event) {
    case "sessionStart":
    case "userPromptSubmit":
      return { ...base, prompt: sample.prompt ?? "Hook test" };
    case "preToolUse":
      return { ...base, toolName, toolArgs };
    case "postToolUse":
      return {
        ...base,
        toolName,
        toolArgs,
        toolOk: sample.toolOk ?? true,
        toolOutput: "Hook test",
      };
    case "permission": {
      const action = sample.permissionAction ?? "read";
      const target = action === "shell" ? sample.command : sample.path;
      return {
        ...base,
        toolName,
        toolArgs,
        permission: { action, policy: "allow", tool: toolName, ...(target ? { target } : {}) },
      };
    }
    case "compact":
      return {
        ...base,
        compact: { reason: "manual", summary: "Hook test", tokensBefore: 100, tokensAfter: 50 },
      };
    case "notification":
      return { ...base, notification: { level: "info", message: "Hook test", code: "test" } };
    case "subagent":
      return {
        ...base,
        toolName: "task",
        toolArgs: { agent: "scout", prompt: sample.prompt ?? "Hook test" },
        subagent: { agent: "scout", phase: "start", task: sample.prompt ?? "Hook test" },
      };
    case "toolBatch":
      return {
        ...base,
        toolBatch: { tools: [{ name: toolName, args: toolArgs }], parallel: false },
      };
    case "stop":
    case "sessionEnd":
      return { ...base, stopReason: "end" };
  }
}

/** An explicit test runs the current draft, even when disabled, without saving it. */
export async function testHook(
  cwd: string,
  config: HarnessConfig,
  raw: unknown,
): Promise<HookTestResult> {
  const input = Input.parse(raw);
  const hook = input.hook ?? config.hooks[input.event][input.index ?? -1];
  if (!hook) throw new Error("Hook not found. Choose an existing hook or provide a draft.");
  const sample = sampleInput(input.event, cwd, {
    ...input.sample,
    ...(input.toolName ? { toolName: input.toolName } : {}),
  });
  const matched = matcherMatches(hook, sample);
  const result = await createHookRunner({
    [input.event]: [{ ...hook, enabled: true, async: false }],
  }).run(input.event, sample, AbortSignal.timeout(hook.timeoutMs + 500));
  return {
    ...result,
    matched,
    runs: result.runs.map((run) => ({ ...run, index: input.index ?? 0 })),
  };
}
