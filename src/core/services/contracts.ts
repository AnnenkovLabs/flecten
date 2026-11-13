import type { ModelEvent, ModelProvider, ModelRequest } from "../../providers/types";
import type { Tool, ToolContext } from "../../tools/types";
import type { CompactionOptions, CompactionResult } from "../loop/context";
import type { LoopOptions, LoopResult } from "../loop/types";
import type { Message, ToolResult } from "../types";
import { serviceContract } from "./registry";
import type { StorageRequest } from "./storage";

export const harnessServices = {
  storage: serviceContract<(request: StorageRequest) => Promise<unknown>>("harness.storage@1"),
  agent:
    serviceContract<(prompt: string, options: LoopOptions) => Promise<LoopResult>>(
      "harness.agent@1",
    ),
  model:
    serviceContract<
      (
        request: ModelRequest,
        signal: AbortSignal,
        provider: ModelProvider,
      ) => Promise<AsyncIterable<ModelEvent>>
    >("harness.model@1"),
  compact:
    serviceContract<(messages: Message[], options: CompactionOptions) => Promise<CompactionResult>>(
      "harness.compact@1",
    ),
  tool: serviceContract<(tool: Tool, input: unknown, context: ToolContext) => Promise<ToolResult>>(
    "harness.tool@1",
  ),
};
