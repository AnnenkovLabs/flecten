import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ProviderConfigSchema } from "../src/config/schema";
import { createSession } from "../src/core/session/session";
import type { Event, RunResult, Usage } from "../src/core/types";
import { createOpenAiChat } from "../src/providers/openai-chat";
import type { ModelProvider, ProviderRuntime } from "../src/providers/types";
import { CheckpointStore } from "../src/store/checkpoints";
import { builtinTools } from "../src/tools/builtin";
import { ToolRegistry } from "../src/tools/registry";
import { evaluateChecks, type CheckOutcome, type Observation, type ToolRecord } from "./checks";
import { createFixture } from "./fixture";
import { createMockProvider } from "./mock-provider";
import { costOf, type Pricing } from "./pricing";
import type { BenchTask } from "./schema";

const MODEL = "bench-mock-1";

export type TaskStatus = "passed" | "failed" | "error";

export interface TaskRunResult {
  task: BenchTask;
  status: TaskStatus;
  durationMs: number;
  usage: Usage;
  costUsd: number;
  turns: number;
  stopReason: string;
  checks: CheckOutcome[];
  scriptExhausted: boolean;
  error?: string;
}

const LIMITS = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

function emptyUsage(): Usage {
  return { input: 0, output: 0, cached: 0 };
}

function runtimeFor(baseUrl: string): ProviderRuntime {
  const config = ProviderConfigSchema.parse({ protocol: "openai-chat", baseUrl });
  return {
    providerId: MODEL,
    protocol: "openai-chat",
    baseUrl,
    headers: config.headers,
    config,
    modelConfig: () => undefined,
  };
}

function providerFor(baseUrl: string): ModelProvider {
  const adapter = createOpenAiChat(runtimeFor(baseUrl));
  return {
    id: MODEL,
    model: MODEL,
    stream: (request, signal) => adapter.stream({ ...request, model: MODEL }, signal),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTask(task: BenchTask, pricing: Pricing): Promise<TaskRunResult> {
  const cwd = await createFixture(task.files);
  const mock = createMockProvider(task.script);
  let session: ReturnType<typeof createSession> | undefined;
  try {
    const checkpoints = new CheckpointStore({ cwd });
    await checkpoints.init();
    const options = task.options;
    const tools = builtinTools();
    if (options.tools?.some((name) => !tools.some((tool) => tool.name === name))) throw new Error("Unknown benchmark tool");
    session = createSession({
      cwd,
      provider: providerFor(mock.baseUrl),
      providerId: MODEL,
      model: MODEL,
      tools: new ToolRegistry(options.tools ? tools.filter((tool) => options.tools!.includes(tool.name)) : tools, { limits: LIMITS }),
      system: "You are running a deterministic benchmark task. Use the available tools.",
      limits: LIMITS,
      maxOutputTokens: options.maxOutputTokens ?? 1024,
      context: {
        window: options.contextWindow ?? 100_000,
        reserve: options.reserveTokens ?? 1000,
      },
      loop: {
        maxTurns: options.maxTurns ?? 8,
        continuations: options.continuations ?? 0,
        parallelTools: options.parallelTools ?? true,
      },
      checkpoints,
      logDir: (sessionId) => join(cwd, ".liquid", "sessions", sessionId, "logs"),
    });
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));

    let result: RunResult | undefined;
    let failure: string | undefined;
    const started = performance.now();
    try {
      result = (await session.send({ type: "run", prompt: task.prompt })) as RunResult;
    } catch (error) {
      failure = messageOf(error);
    }
    const durationMs = Math.round(performance.now() - started);
    await session.flush();

    if (result === undefined) {
      return {
        task,
        status: "error",
        durationMs,
        usage: emptyUsage(),
        costUsd: 0,
        turns: 0,
        stopReason: "error",
        checks: [],
        scriptExhausted: mock.scriptExhausted,
        ...(failure === undefined ? {} : { error: failure }),
      };
    }

    const toolResults: ToolRecord[] = [];
    for (const event of events) {
      if (event.type === "tool.finished") toolResults.push({ call: event.call, result: event.result });
    }
    const observation: Observation = {
      result,
      events,
      tools: toolResults,
      requests: mock.requests,
      checkpoints: await checkpoints.list(),
      store: checkpoints,
    };
    const checks = await evaluateChecks(task.checks, cwd, observation);
    const passed = checks.every((check) => check.ok === true);
    const status: TaskStatus =
      result.stopReason === "error" ? "error" : passed && !mock.scriptExhausted ? "passed" : "failed";
    return {
      task,
      status,
      durationMs,
      usage: result.usage,
      costUsd: costOf(result.usage, pricing),
      turns: result.turns,
      stopReason: result.stopReason,
      checks,
      scriptExhausted: mock.scriptExhausted,
      ...(failure === undefined ? {} : { error: failure }),
    };
  } finally {
    await session?.dispose().catch(() => undefined);
    mock.stop();
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
