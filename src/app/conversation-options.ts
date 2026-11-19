import type { ModelChoice } from "../../shared/model-choice";
import type { HarnessConfig } from "../config/schema";
import type { PromptSection } from "../core/prompt";
import type { SessionOptions } from "../core/session/options";
import type { Event } from "../core/types";
import { contextTool } from "../tools/context/run";
import { ToolRegistry } from "../tools/registry";
import type { ToolContext } from "../tools/types";
import type { ConversationTwinPort } from "./conversation-twin";
import { moduleInspection } from "./module-inspection";
import { modelContext } from "./provider-state";
import { systemPrompt } from "./session-config";
import { sessionModelOptions, sessionModelTools } from "./session-model-options";
import { withModelChoice } from "./session-models";
import { subagentModelFactory } from "./subagent-models";
import { twinQuestion } from "./twin-question";
import { askTalkerTool, criterionTool, type WorkerRequest, workerTool } from "./worker-tool";

const INSPECTION_TOOLS = new Set(["read", "grep", "glob", "memory", "skill", "module"]);

export interface ConversationOptions {
  events: readonly Event[];
  twin?: ConversationTwinPort;
  configure(
    options: SessionOptions,
    execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
    answer: (question: string, signal: AbortSignal) => Promise<string | undefined>,
  ): Promise<{ talker: SessionOptions; worker: SessionOptions }>;
}

/** Keep presentation and skill discovery with the Talker; execution retains project rules. */
export async function conversationOptions(
  options: SessionOptions,
  config: HarnessConfig,
  sections: readonly PromptSection[],
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
  answer?: (question: string, signal: AbortSignal) => Promise<string | undefined>,
  projectRoot?: string | null,
  choice?: ModelChoice,
) {
  const workerChoice = choice ?? config.conversation?.worker;
  const workerConfig = workerChoice ? withModelChoice(config, workerChoice) : config;
  const talkerConfig = config.conversation?.talker
    ? withModelChoice(workerConfig, config.conversation.talker)
    : workerConfig;
  const modelOptions = (current: HarnessConfig, configured: boolean) =>
    configured
      ? sessionModelOptions(
          current,
          current.provider === options.providerId &&
            current.model === options.model &&
            current.variant === options.variant
            ? options.provider
            : undefined,
        )
      : {};
  const source = sessionModelTools(workerConfig, options.tools);
  const talkerSource = sessionModelTools(talkerConfig, options.tools);
  const control = workerTool(execute);
  const criteria = criterionTool(execute);
  const question = askTalkerTool(execute);
  const talkerTools = new ToolRegistry(
    [
      ...talkerSource
        .list()
        .filter(
          (tool) => INSPECTION_TOOLS.has(tool.name) && (options.memory || tool.name !== "memory"),
        )
        .map((tool) => (tool.name === "module" ? moduleInspection(tool) : tool)),
      control,
    ],
    {
      limits: options.limits,
      deferredMcp: source.deferredMcp,
      authorize: (tool, context) =>
        tool.name === control.name ? undefined : source.authorize(tool.name, context),
    },
  );
  const workerTools = new ToolRegistry(
    [
      ...source
        .list()
        .filter(
          (tool) =>
            tool.name !== "done" &&
            tool.name !== "context" &&
            (options.memory || tool.name !== "memory"),
        )
        .map((tool) => (tool.name === "ask" && answer ? twinQuestion(tool, answer) : tool)),
      ...(options.pages ? [contextTool] : []),
      criteria,
      question,
    ],
    {
      limits: options.limits,
      deferredMcp: source.deferredMcp,
      authorize: (tool, context) =>
        tool.name === contextTool.name || tool.name === criteria.name || tool.name === question.name
          ? undefined
          : (source.authorize(tool.name, context) ??
            source.authorize(tool.name, {
              ...context,
              sessionId: options.sessionId ?? context.sessionId,
            })),
    },
  );
  const [talker, worker] = await Promise.all([
    systemPrompt(options.cwd, talkerConfig, sections, talkerTools, "talker", projectRoot),
    systemPrompt(
      options.cwd,
      workerConfig,
      sections.filter((section) => section.id !== "skills"),
      workerTools,
      "worker",
      projectRoot,
    ),
  ]);
  return {
    talker: {
      ...options,
      ...modelOptions(talkerConfig, Boolean(config.conversation?.talker || workerChoice)),
      ...(options.subagentRunnerFactory
        ? {
            subagentRunnerFactory: subagentModelFactory(
              options.subagentRunnerFactory,
              talkerConfig,
            ),
          }
        : {}),
      reasoning: config.conversation?.talker?.reasoning ?? talkerConfig.reasoning,
      variant: config.conversation?.talker?.variant ?? talkerConfig.variant,
      context: modelContext(talkerConfig),
      role: "talker" as const,
      responseFormat: "conversation" as const,
      language: undefined,
      tools: talkerTools,
      ...talker,
      promptStamp: talker.stamp,
    },
    worker: {
      ...options,
      ...modelOptions(workerConfig, Boolean(workerChoice)),
      ...(options.subagentRunnerFactory
        ? {
            subagentRunnerFactory: subagentModelFactory(
              options.subagentRunnerFactory,
              workerConfig,
            ),
          }
        : {}),
      context: modelContext(workerConfig),
      role: "worker" as const,
      language: undefined,
      tools: workerTools,
      ...worker,
      promptStamp: worker.stamp,
    },
  };
}
