import type { HarnessConfig } from "../config/schema";
import type { PromptSection } from "../core/prompt";
import type { SessionOptions } from "../core/session/options";
import { contextTool } from "../tools/context/run";
import { ToolRegistry } from "../tools/registry";
import type { ToolContext } from "../tools/types";
import { moduleInspection } from "./module-inspection";
import { systemPrompt } from "./session-config";
import { twinQuestion } from "./twin-question";
import { type WorkerRequest, workerTool } from "./worker-tool";

const INSPECTION_TOOLS = new Set(["read", "grep", "glob", "skill", "module", "memory"]);

/** Keep presentation and skill discovery with the Talker; execution retains project rules. */
export async function conversationOptions(
  options: SessionOptions,
  config: HarnessConfig,
  sections: readonly PromptSection[],
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
  answer?: (question: string, signal: AbortSignal) => Promise<string | undefined>,
) {
  const source = options.tools;
  const control = workerTool(execute);
  const talkerTools = new ToolRegistry(
    [
      ...source
        .list()
        .filter((tool) => INSPECTION_TOOLS.has(tool.name))
        .map((tool) => (tool.name === "module" ? moduleInspection(tool) : tool)),
      control,
    ],
    {
      limits: options.limits,
      authorize: (tool, context) =>
        tool.name === control.name ? undefined : source.authorize(tool.name, context),
    },
  );
  const workerTools = new ToolRegistry(
    [
      ...source
        .list()
        .filter((tool) => tool.name !== "done" && tool.name !== "context")
        .map((tool) => (tool.name === "ask" && answer ? twinQuestion(tool, answer) : tool)),
      ...(options.pages ? [contextTool] : []),
    ],
    {
      limits: options.limits,
      authorize: (tool, context) =>
        tool.name === contextTool.name
          ? undefined
          : (source.authorize(tool.name, context) ??
            source.authorize(tool.name, {
              ...context,
              sessionId: options.sessionId ?? context.sessionId,
            })),
    },
  );
  const [talker, worker] = await Promise.all([
    systemPrompt(options.cwd, config, sections, talkerTools, "talker"),
    systemPrompt(
      options.cwd,
      config,
      sections.filter((section) => section.id !== "skills"),
      workerTools,
      "worker",
    ),
  ]);
  return {
    talker: {
      ...options,
      role: "talker" as const,
      responseFormat: "conversation" as const,
      language: undefined,
      tools: talkerTools,
      ...talker,
      promptStamp: talker.stamp,
    },
    worker: {
      ...options,
      role: "worker" as const,
      language: undefined,
      tools: workerTools,
      ...worker,
      promptStamp: worker.stamp,
    },
  };
}
