import { type ProviderResponse, responseOfError } from "./response";
import { TransportError } from "./transport";
import type { ModelEvent } from "./types";

/** Stamp the actual route before failover so accounting never borrows the winner's price. */
export async function* providerAttempt(
  source: AsyncIterable<ModelEvent>,
  target: { provider: string; model: string; protocol: string },
): AsyncGenerator<ModelEvent> {
  const identity = {
    provider: target.provider,
    model: target.model,
    attemptId: crypto.randomUUID(),
  };
  const started = Date.now();
  let reported = false;
  let receipt = false;
  const fallback = (
    outcome: string,
    status: ProviderResponse["status"],
    requested = true,
  ): ProviderResponse => ({
    protocol: target.protocol,
    ...identity,
    requested,
    status,
    outcome,
    frames: 0,
    invalidFrames: 0,
    unsupportedFrames: 0,
    textBytes: 0,
    reasoningBytes: 0,
    toolCalls: 0,
    usage: reported ? "reported" : "missing",
    terminal: status === "complete",
    durationMs: Date.now() - started,
  });
  try {
    for await (const event of source) {
      if (event.type === "usage") {
        reported = true;
        yield { ...event, ...identity };
      } else if (event.type === "response") {
        receipt = true;
        yield { type: "response", response: { ...event.response, ...identity, requested: true } };
      } else if (event.type === "done") {
        receipt = true;
        yield {
          ...event,
          response: event.response
            ? { ...event.response, ...identity, requested: true }
            : fallback(event.reason, "complete"),
        };
      } else yield event;
    }
  } catch (error) {
    if (!receipt) {
      const original = responseOfError(error);
      const requested = !(error instanceof TransportError && error.requested === false);
      yield {
        type: "response",
        response: original
          ? { ...original, ...identity, requested }
          : fallback(
              error instanceof TransportError ? error.reason : "provider_failure",
              "failed",
              requested,
            ),
      };
    }
    throw error;
  }
}
