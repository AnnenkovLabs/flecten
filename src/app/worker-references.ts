import type { Event, SessionEvent, ToolCall } from "../core/types";

/** Display identifiers never depend on provider identifiers or another chat's calls. */
export class WorkerReferences {
  readonly #latest = new Map<string, string>();
  readonly #active = new Map<string, string>();
  readonly #mapped = new WeakMap<Event, SessionEvent>();

  raw(reference: string): string | undefined {
    return this.#active.get(reference);
  }

  event(input: Event): SessionEvent {
    const cached = this.#mapped.get(input);
    if (cached) return cached;
    if (input.type === "worker.event") throw new Error("Nested Workers are not supported");
    let event: SessionEvent = input;
    const call = (value: ToolCall): ToolCall => ({ ...value, id: this.#reference(value.id) });
    if (input.type === "message.finished") {
      for (const item of input.toolCalls) this.#latest.set(item.id, `w_${crypto.randomUUID()}`);
      event = { ...input, toolCalls: input.toolCalls.map(call) };
    } else if (input.type === "tool.started") {
      const shown = call(input.call);
      this.#active.set(shown.id, input.call.id);
      event = { ...input, call: shown };
    } else if (input.type === "tool.finished") {
      const shown = call(input.call);
      this.#active.delete(shown.id);
      event = { ...input, call: shown };
    } else if (input.type === "tool.output") {
      event = { ...input, callId: this.#reference(input.callId) };
    } else if (input.type === "subagent.started") {
      event = {
        ...input,
        subagent: { ...input.subagent, callId: this.#reference(input.subagent.callId) },
      };
    } else if (input.type === "approval.requested" && input.approval.callId) {
      event = {
        ...input,
        approval: { ...input.approval, callId: this.#reference(input.approval.callId) },
      };
    }
    this.#mapped.set(input, event);
    return event;
  }

  #reference(raw: string): string {
    let reference = this.#latest.get(raw);
    if (!reference) {
      reference = `w_${crypto.randomUUID()}`;
      this.#latest.set(raw, reference);
    }
    return reference;
  }
}
