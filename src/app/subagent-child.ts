import { z } from "zod";
import { acceptsImages } from "../../shared/vision";
import type { HarnessConfig } from "../config/schema";
import type { MemoryPort } from "../core/memory/types";
import { buildPrompt } from "../core/prompt";
import { createSession, type SessionOptions } from "../core/session/session";
import type { SubagentChildRequest, SubagentChildResult } from "../core/subagents/types";
import type { RunResult, ToolCall } from "../core/types";
import { emptyUsage } from "../core/types/message";
import { createProvider } from "../providers/registry";
import type { ModelProvider } from "../providers/types";
import { PermissionEngine } from "../security/permissions";
import type { SandboxPolicy } from "../security/sandbox";
import { loadSessionMedia, saveSessionMedia } from "../store/attachments";
import type { CheckpointStore, ShellCheckpointService } from "../store/checkpoints";
import { sessionPaths } from "../store/paths";
import { readTool } from "../tools/read/tool";
import { ToolRegistry } from "../tools/registry";
import type { OsSandboxContext } from "../tools/types";
import { readOnlyMemory } from "./memory";
import { configSecrets } from "./provider-secrets";
import { maxOutputTokens, modelContext } from "./provider-state";
import { inputModalities } from "./service-policy";
import { terminalSettings, usagePrice } from "./session-config";
import { formatSubagentReport } from "./subagent-report";
import { translationOptions } from "./translation";
import { visionOptions } from "./vision";

export interface ChildRuntime {
  dictionary?: SessionOptions["dictionary"];
  modules?: SessionOptions["modules"];
  memory?: MemoryPort;
  cwd: string;
  config(): HarnessConfig;
  provider(): ModelProvider;
  tools(): ToolRegistry;
  trusted(): boolean;
  checkpoints: CheckpointStore;
  shellCheckpoints(): ShellCheckpointService | undefined;
  sandbox(): SandboxPolicy | undefined;
  osSandbox(): OsSandboxContext | undefined;
}

/**
 * Runs one subagent as a child session with its own tools, permissions and budget. A child
 * asks through the parent's gate when one exists; without it, requests fail closed.
 */
export function subagentChildRunner(runtime: ChildRuntime) {
  const language = translationOptions();
  return async (request: SubagentChildRequest): Promise<SubagentChildResult> => {
    const config = runtime.config();
    const providerId = request.spec.provider ?? config.provider;
    const model = request.spec.model ?? config.model;
    const childConfig = { ...config, provider: providerId, model };
    let childProvider: ModelProvider;
    try {
      childProvider =
        providerId === config.provider && model === config.model
          ? runtime.provider()
          : createProvider(childConfig, providerId).provider;
    } catch (error) {
      return {
        text: "",
        usage: emptyUsage(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const tools = runtime.tools();
    const allowed = new Set(request.allowedTools.map((name) => tools.canonicalName(name)));
    const childTools = new ToolRegistry(
      tools
        .list()
        .filter((tool) => allowed.has(tool.name))
        .map((tool) =>
          tool.name === "read" ? readTool(!acceptsImages(inputModalities(childConfig))) : tool,
        ),
      { limits: config.tools, authorize: (tool) => request.parentAuthorize?.(tool.name) },
    );
    const built = await buildPrompt(runtime.cwd, {
      tools: childTools.specs(),
      ...(config.context.promptBudget === undefined
        ? {}
        : { maxPromptTokens: config.context.promptBudget }),
      responseFormat: "structured",
      sections: [
        { id: "role", text: request.systemPrompt, required: true },
        {
          id: "result-schema",
          text: `# Required result schema\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(request.spec.resultSchema), null, 2)}\n\`\`\``,
          required: true,
        },
        ...(request.parentContext
          ? [{ id: "parent-context", text: `# Parent context\n\n${request.parentContext}` }]
          : []),
      ],
    });
    const sandbox = runtime.sandbox();
    const osSandbox = runtime.osSandbox();
    const shellCheckpoints = runtime.shellCheckpoints();
    const child = createSession({
      role: "worker",
      ...(runtime.modules ? { modules: runtime.modules } : {}),
      ...(runtime.memory ? { memory: readOnlyMemory(runtime.memory) } : {}),
      ...(runtime.dictionary ? { dictionary: runtime.dictionary } : {}),
      cwd: runtime.cwd,
      secrets: () => configSecrets(runtime.config()),
      provider: childProvider,
      modalities: inputModalities(childConfig),
      vision: visionOptions(childConfig),
      saveMedia: (id, parts) => saveSessionMedia(runtime.cwd, id, parts),
      loadMedia: (id, refs) => loadSessionMedia(runtime.cwd, id, refs),
      language: language(
        config.translation?.enabled
          ? {
              ...config,
              translation: { ...config.translation, language: "en" },
            }
          : config,
      ),
      providerId,
      model,
      tools: childTools,
      system: built.system,
      systemParts: built.systemParts,
      responseFormat: "structured",
      budgets: {
        maxTokens: request.budget.maxTokens,
        ...(request.budget.maxCost === undefined ? {} : { maxCostUsd: request.budget.maxCost }),
      },
      price: usagePrice(childConfig),
      limits: config.tools,
      maxOutputTokens: Math.max(
        1,
        Math.min(maxOutputTokens(childConfig), request.budget.maxTokens),
      ),
      ...(config.reasoning ? { reasoning: config.reasoning } : {}),
      context: modelContext(childConfig),
      loop: {
        maxTurns: request.budget.maxTurns,
        continuations: 0,
        parallelTools: config.loop.parallelTools,
      },
      ...(runtime.trusted() ? { hooks: config.hooks } : {}),
      permissions: new PermissionEngine(
        { rules: [...request.permissions] },
        request.parentPermissions,
      ),
      approvalTimeoutMs: 0,
      ...(request.parentApprovals ? { inheritedApprovals: request.parentApprovals } : {}),
      ...(request.approvalSessionId ? { approvalSessionId: request.approvalSessionId } : {}),
      permissionActor: request.spec.id,
      ...(request.permissionIntent ? { permissionIntent: request.permissionIntent } : {}),
      terminal: terminalSettings(config),
      checkpoints: runtime.checkpoints,
      ...(shellCheckpoints ? { shellCheckpoints } : {}),
      ...(sandbox ? { sandbox } : {}),
      ...(osSandbox ? { osSandbox } : {}),
      security: () => ({ sandbox: runtime.sandbox(), osSandbox: runtime.osSandbox() }),
      logDir: (sessionId) => sessionPaths(runtime.cwd, sessionId).logs,
    });
    let text = "";
    let usage = emptyUsage();
    const toolCalls: ToolCall[] = [];
    const unsubscribe = child.subscribe((event) => {
      if (
        event.type !== "worker.event" &&
        event.type !== "subagent.event" &&
        event.type !== "subagent.started" &&
        event.type !== "subagent.finished"
      )
        request.onEvent?.(event);
      if (event.type !== "message.finished") return;
      if (event.text.trim().length > 0) text = event.text;
      toolCalls.push(...event.toolCalls);
    });
    const stop = (): void => {
      void child.send({ type: "stop" });
    };
    if (request.signal.aborted) {
      unsubscribe();
      await child.dispose();
      return { text: "", usage, error: "Subagent was cancelled." };
    }
    request.signal.addEventListener("abort", stop, { once: true });
    try {
      const prompt = request.messages
        .map((message) => (message.role === "user" ? message.content : ""))
        .filter((content) => content.length > 0)
        .join("\n\n");
      const result = (await child.send({ type: "run", prompt })) as RunResult;
      usage = {
        ...result.usage,
        ...(result.budget?.spent.costUsd === undefined
          ? {}
          : { cost: result.budget.spent.costUsd }),
      };
      if (text.length === 0) {
        const assistant = [...child.getHistory()]
          .reverse()
          .find((message) => message.role === "assistant" && message.content.trim().length > 0);
        if (assistant?.role === "assistant") text = assistant.content;
      }
      const error =
        result.stopReason === "error"
          ? result.summary || "Subagent run failed."
          : result.stopReason === "stopped"
            ? "Subagent was cancelled."
            : result.stopReason === "budget" || result.stopReason === "max_turns"
              ? `Subagent stopped before completion: ${result.stopReason}.`
              : undefined;
      return await formatSubagentReport({
        request,
        provider: childProvider,
        model,
        history: child.getHistory(),
        maxTokens: maxOutputTokens(childConfig),
        price: usagePrice(childConfig),
        result: {
          text: text || result.summary,
          usage,
          turns: result.turns,
          toolCalls,
          ...(error ? { error } : {}),
        },
      });
    } finally {
      request.signal.removeEventListener("abort", stop);
      unsubscribe();
      await child.dispose().catch(() => undefined);
    }
  };
}
