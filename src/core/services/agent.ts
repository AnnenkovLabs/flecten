import { abortable } from "../../util/abort";
import { runLoop } from "../loop/loop";
import type { LoopOptions, LoopResult } from "../loop/types";
import { eventSchema } from "../types/event-schema";
import { harnessServices } from "./contracts";
import { ServiceLoopResultSchema } from "./validation";

/** Alternative drivers retain the session's queue, budgets, approvals, persistence and UI. */
export async function runAgent(prompt: string, options: LoopOptions): Promise<LoopResult> {
  const services = options.toolContext.services;
  if (!services?.has(harnessServices.agent)) return runLoop(prompt, options);
  const expectedSystem = options.system;
  const expectedTools = JSON.stringify(options.tools.specs());
  const fallback = (input: string, next: LoopOptions) => {
    if (next.system !== expectedSystem || JSON.stringify(next.tools.specs()) !== expectedTools)
      throw new Error(
        "Agent services must preserve the system prompt and provider tool definitions",
      );
    return runLoop(input, next);
  };
  const originalEmit = options.emit;
  const checked = {
    ...options,
    emit: (event: Parameters<LoopOptions["emit"]>[0]) => {
      eventSchema.parse({ ...event, sessionId: options.toolContext.sessionId });
      originalEmit(event);
    },
  };
  options.signal.throwIfAborted();
  const result = await abortable(
    services.invoke(harnessServices.agent, fallback, prompt, checked),
    options.signal,
  );
  options.signal.throwIfAborted();
  ServiceLoopResultSchema.parse(result);
  if (options.messages && options.messages !== result.messages)
    options.messages.splice(0, options.messages.length, ...result.messages);
  return result;
}
