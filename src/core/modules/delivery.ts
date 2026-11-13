import { estimateTokens, PROFILE_4 } from "../../context";
import { HarnessError } from "../../errors";
import type { LoopOptions } from "../loop/types";
import type { Message } from "../types";

/** Append only. Neither a module update nor deactivation edits historical messages or tool specs. */
export async function deliverModules(messages: Message[], options: LoopOptions): Promise<void> {
  const delivery = await options.modules?.beforeTurn(
    options.toolContext.sessionId,
    messages,
    options.signal,
  );
  if (!delivery) return;
  const required = estimateTokens(
    options.system + delivery.text + JSON.stringify(options.tools.specs()),
    PROFILE_4,
  ).tokens;
  if (required + options.reserveTokens + 1024 >= options.contextWindow)
    throw new HarnessError(
      "context_overflow",
      "Active module instructions do not fit this model's context. Deactivate modules or use a larger context window.",
    );
  messages.push({ role: "user", content: delivery.text, moduleReferences: delivery.references });
  options.emit({
    type: "notice.applied",
    text: delivery.text,
    moduleReferences: delivery.references,
  });
}
