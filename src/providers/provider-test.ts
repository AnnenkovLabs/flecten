import type { HarnessConfig, ProviderConfig } from "../config/schema";
import { createProvider } from "./registry";

export async function testProvider(
  definition: ProviderConfig,
  model: string,
  providerId = "test",
): Promise<{
  ok: boolean;
  message: string;
  latencyMs: number;
  errorKind?: string;
  status?: number;
}> {
  const started = performance.now();
  const modelLimit = definition.models[model]?.output;
  const maxTokens = modelLimit !== undefined && modelLimit > 0 ? Math.min(1024, modelLimit) : 1024;
  const testDefinition: ProviderConfig = {
    ...definition,
    transport: {
      ...definition.transport,
      retries: definition.transport?.retries ?? 1,
    },
  };
  const config: HarnessConfig = {
    useDefaults: false,
    provider: providerId,
    model,
    providers: { [providerId]: testDefinition },
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
    maxOutputTokens: maxTokens,
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
  try {
    const active = createProvider(config, providerId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("test timed out")), 30_000);
    let text = "";
    try {
      for await (const event of active.provider.stream(
        {
          model,
          system: "Reply with the single word OK.",
          messages: [{ role: "user", content: "ping" }],
          tools: [],
          maxTokens,
        },
        controller.signal,
      )) {
        if (event.type === "text") text += event.delta;
        if (event.type === "done") break;
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      ok: true,
      message: text.trim().length > 0 ? text.trim().slice(0, 200) : "connected",
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const err = error as {
      name?: unknown;
      code?: unknown;
      status?: unknown;
      limit?: unknown;
      reason?: unknown;
      response?: { outcome?: unknown };
    };
    const status = typeof err?.status === "number" ? err.status : undefined;
    const errorKind =
      typeof err?.name === "string" && err.name === "MissingKeyError"
        ? "missing_api_key"
        : typeof err?.name === "string" && err.name === "LimitError"
          ? "provider_limit"
          : typeof err?.name === "string" && err.name === "ProviderResponseError"
            ? "provider_stream"
            : typeof err?.name === "string" &&
                err.name === "TransportError" &&
                typeof err.reason === "string"
              ? `transport_${err.reason}`
              : typeof err?.name === "string" &&
                  err.name === "HarnessError" &&
                  typeof err.code === "string"
                ? err.code
                : typeof err?.name === "string" && err.name === "AbortError"
                  ? "aborted"
                  : typeof err?.code === "string" && err.code.length > 0
                    ? `os_${err.code}`
                    : "runtime_error";
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - started),
      errorKind,
      ...(status !== undefined ? { status } : {}),
    };
  }
}
