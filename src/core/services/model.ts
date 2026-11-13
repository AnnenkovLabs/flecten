import type { ModelProvider, ModelRequest } from "../../providers/types";
import { abortable } from "../../util/abort";
import { harnessServices } from "./contracts";
import type { Services } from "./registry";
import { checkedModelEvents, freezeValue } from "./validation";

/** A wrapper may route a request, but cannot invalidate its cached prefix. */
export async function* serviceModelStream(
  provider: ModelProvider,
  request: ModelRequest,
  signal: AbortSignal,
  services?: Services,
) {
  if (!services?.has(harnessServices.model)) {
    yield* provider.stream(request, signal);
    return;
  }
  const original = freezeValue(structuredClone(request));
  const prefix = JSON.stringify(original.messages);
  const fallback = async (next: ModelRequest, abort: AbortSignal, target: ModelProvider) => {
    if (
      next.system !== original.system ||
      JSON.stringify(next.tools) !== JSON.stringify(original.tools) ||
      JSON.stringify(next.messages) !== prefix
    )
      throw new Error("Model services must preserve the cacheable system, tool and history prefix");
    return target.stream(next, abort);
  };
  const pending = services.invoke(harnessServices.model, fallback, original, signal, provider);
  let streaming = false;
  try {
    const source = await abortable(pending, signal);
    streaming = true;
    yield* checkedModelEvents(source, signal);
  } catch (error) {
    if (!streaming && signal.aborted)
      void pending
        .then((source) => source[Symbol.asyncIterator]().return?.())
        .catch(() => undefined);
    throw error;
  }
}
