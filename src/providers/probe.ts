import type { HarnessConfig, ModelConfig, ProviderConfig } from "../config/schema";
import { createProvider } from "./registry";
import type { ModelEvent, ModelRequest, ToolSchema } from "./types";

export interface ProbeResult {
  text: boolean;
  tools: boolean;
  reasoning?: boolean;
  latencyMs: number;
  error?: string;
}

const readTool: ToolSchema = {
  name: "read",
  description: "Read a file from the workspace.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "File path to read" } },
    required: ["path"],
    additionalProperties: false,
  },
};

function probeConfig(definition: ProviderConfig, modelId: string): HarnessConfig {
  const current = definition.models[modelId];
  const model: ModelConfig = {
    ...(current ?? {}),
    name: current?.name ?? modelId,
    tools: true,
    reasoning: true,
  };
  const providers: Record<string, ProviderConfig> = {
    probe: {
      ...definition,
      models: { ...definition.models, [modelId]: model },
    },
  };
  return {
    useDefaults: false,
    provider: "probe",
    model: modelId,
    providers,
    mcp: { servers: {} },
    hooks: {
      sessionStart: [],
      userPromptSubmit: [],
      preToolUse: [],
      postToolUse: [],
      stop: [],
      sessionEnd: [],
      permission: [],
      compact: [],
      notification: [],
      subagent: [],
      toolBatch: [],
    },
    maxOutputTokens: 1024,
    catalog: { autoRefresh: false, ttlMs: 43_200_000 },
    context: { window: 128_000, reserve: 1_000 },
    loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    tools: {
      maxOutputBytes: 10_000,
      maxOutputLines: 100,
      bashTimeoutMs: 5_000,
      readLimitLines: 100,
    },
  };
}

async function collect(
  definition: ProviderConfig,
  modelId: string,
  request: ModelRequest,
  timeoutMs = 45_000,
): Promise<{ events: ModelEvent[]; text: string; error?: string }> {
  const provider = createProvider(probeConfig(definition, modelId), "probe");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("probe timed out")), timeoutMs);
  const events: ModelEvent[] = [];
  let text = "";
  try {
    for await (const event of provider.provider.stream(request, controller.signal)) {
      events.push(event);
      if (event.type === "text") text += event.delta;
      if (event.type === "done") break;
    }
    return { events, text };
  } catch (error) {
    return {
      events,
      text,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeModel(
  definition: ProviderConfig,
  modelId: string,
): Promise<ProbeResult> {
  const started = performance.now();
  const base = {
    model: modelId,
    system: "You are a capability probe. Follow the instruction exactly.",
    maxTokens: 256,
  };
  const text = await collect(definition, modelId, {
    ...base,
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    tools: [],
  });
  let tools = await collect(definition, modelId, {
    ...base,
    messages: [
      {
        role: "user",
        content: "Use the read tool to read package.json. Do not answer with text.",
      },
    ],
    tools: [readTool],
    toolChoice: "required",
    maxTokens: 256,
  });
  if (!tools.events.some((event) => event.type === "tool_call")) {
    tools = await collect(definition, modelId, {
      ...base,
      messages: [
        {
          role: "user",
          content: "Call the read tool with path package.json. This is a capability test.",
        },
      ],
      tools: [readTool],
      toolChoice: "auto",
      maxTokens: 256,
    });
  }
  const reasoning = await collect(definition, modelId, {
    ...base,
    messages: [
      {
        role: "user",
        content: "Think through 17 * 23 step by step, then reply with the number.",
      },
    ],
    tools: [],
    reasoning: "high",
    maxTokens: 1024,
  });
  const sawReasoning = reasoning.events.some((event) => event.type === "reasoning");
  const sawTool = tools.events.some((event) => event.type === "tool_call" && event.name === "read");
  const textOk = text.text.trim().length > 0 && text.error === undefined;
  return {
    text: textOk,
    tools: sawTool,
    ...(sawReasoning ? { reasoning: true } : {}),
    latencyMs: Math.round(performance.now() - started),
    ...(text.error ? { error: text.error } : {}),
  };
}
