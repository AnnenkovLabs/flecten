import protectionPrompt from "../../prompts/provider-protection.md" with { type: "text" };
import { HarnessError } from "../errors";
import type { ModelEvent, ModelRequest } from "../providers/types";
import { isSensitiveKey } from "../util/redact";
import { SecretVault } from "./provider-secrets/vault";

const MAX_CALL_BYTES = 1_048_576;
const MAX_CALLS = 128;
const MAX_TEXT_BYTES = 16 * 1_048_576;

export class ProviderProtection {
  readonly vault = new SecretVault();

  constructor(configuration: unknown) {
    this.vault.protect(configuration);
    this.vault.protect(
      Object.fromEntries(Object.entries(process.env).filter(([key]) => isSensitiveKey(key))),
    );
  }

  request(request: ModelRequest): ModelRequest {
    return this.vault.protect({ ...request, system: `${request.system}\n\n${protectionPrompt}` });
  }

  /** Only declared, bounded calls from a completed response reach the agent loop. */
  async *events(
    source: AsyncIterable<ModelEvent>,
    request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    const declared = new Set(request.tools.map((tool) => tool.name));
    const calls: Extract<ModelEvent, { type: "tool_call" }>[] = [];
    const ids = new Set<string>();
    let bytes = 0;
    let textBytes = 0;
    const text: Array<Extract<ModelEvent, { type: "text" | "reasoning" }>> = [];
    let completed = false;
    const metadata: Extract<ModelEvent, { type: "provider_data" }>[] = [];
    for await (const event of source) {
      if (completed) throw this.#failure("Provider sent data after its terminal event");
      if (event.type === "tool_call_progress") {
        bytes += Buffer.byteLength(event.delta ?? "");
        if (bytes > MAX_CALL_BYTES) throw this.#failure("Provider tool arguments exceed the limit");
        // Partial JSON may contain a credential split across chunks. Publish complete calls only.
        continue;
      }
      if (event.type === "tool_call") {
        if (request.toolChoice === "none" || !declared.has(event.name))
          throw this.#failure("Provider returned an undeclared tool call");
        if (!event.id || ids.has(event.id)) throw this.#failure("Provider reused a tool call ID");
        const serialized = JSON.stringify({ args: event.args, extraContent: event.extraContent });
        bytes += Buffer.byteLength(serialized ?? "");
        if (!serialized || bytes > MAX_CALL_BYTES || calls.length >= MAX_CALLS)
          throw this.#failure("Provider tool arguments exceed the limit");
        ids.add(event.id);
        calls.push(event);
      } else if (event.type === "done") {
        completed = true;
        if (calls.length && event.reason !== "tool_use")
          throw this.#failure("Provider did not complete its tool calls");
        const inspected = this.vault.protect({
          reasoning: text
            .filter((entry) => entry.type === "reasoning")
            .map((entry) => entry.delta)
            .join(""),
          text: text
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.delta)
            .join(""),
          calls,
          metadata,
        });
        // ponytail: protected text waits for completion; an incremental lexical scanner can
        // restore streaming once it preserves multiline and arbitrarily split credentials.
        for (const kind of ["reasoning", "text"] as const) {
          const delta = inspected[kind];
          if (delta) yield { type: kind, delta };
        }
        for (const data of inspected.metadata) yield data;
        for (const call of inspected.calls) yield call;
        yield this.vault.protect(event);
      } else if (event.type === "text" || event.type === "reasoning") {
        textBytes += Buffer.byteLength(event.delta);
        if (textBytes > MAX_TEXT_BYTES)
          throw this.#failure("Provider text exceeds the inspection limit");
        text.push(event);
      } else if (event.type === "provider_data") {
        textBytes += Buffer.byteLength(JSON.stringify(event.data) ?? "");
        if (textBytes > MAX_TEXT_BYTES)
          throw this.#failure("Provider metadata exceeds the inspection limit");
        metadata.push(event);
      } else yield this.vault.protect(event);
    }
    if (!completed) throw this.#failure("Protected provider response ended without completion");
  }

  #failure(message: string): HarnessError {
    return new HarnessError("invalid_input", `Provider protection: ${message}`);
  }
}
