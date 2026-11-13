import type { Event } from "../core/types";

/** The budget already prices worker and translation separately; status reuses that total. */
export class RunSpend {
  readonly #values = new Map<string, { cost?: number }>();
  readonly #twin = new Map<string, { cost: number; known: boolean }>();
  readonly #workerCarry = new Map<string, { cost: number; known: boolean }>();
  readonly #tasks = new Map<string, string>();
  note(event: Event): void {
    if (!event.sessionId) return;
    if (event.type === "twin.activity") {
      if (event.activity.phase === "prepare" && event.activity.state === "disabled") {
        this.#twin.delete(event.sessionId);
        this.#workerCarry.delete(event.sessionId);
        this.#tasks.delete(event.sessionId);
      }
      if (
        event.activity.phase === "prepare" &&
        event.activity.state === "running" &&
        (!event.activity.taskId || this.#tasks.get(event.sessionId) !== event.activity.taskId)
      ) {
        this.#twin.set(event.sessionId, { cost: 0, known: true });
        this.#workerCarry.set(event.sessionId, { cost: 0, known: true });
        this.#values.delete(`${event.sessionId}:worker`);
        if (event.activity.taskId) this.#tasks.set(event.sessionId, event.activity.taskId);
      }
      if (
        event.activity.usage &&
        (!event.activity.taskId || this.#tasks.get(event.sessionId) === event.activity.taskId)
      ) {
        const value = this.#twin.get(event.sessionId) ?? { cost: 0, known: true };
        value.cost += event.activity.usage.costUsd ?? 0;
        value.known &&= event.activity.usage.costUsd !== undefined;
        this.#twin.set(event.sessionId, value);
      }
      return;
    }
    if (event.type === "worker.event") {
      if (event.event.type === "session.started" && this.#twin.has(event.sessionId)) {
        const prior = this.#values.get(`${event.sessionId}:worker`);
        const carry = this.#workerCarry.get(event.sessionId) ?? { cost: 0, known: true };
        if (prior) {
          carry.cost += prior.cost ?? 0;
          carry.known &&= prior.cost !== undefined;
        }
        this.#workerCarry.set(event.sessionId, carry);
      }
      this.note({ ...event.event, sessionId: `${event.sessionId}:worker` });
      return;
    }
    if (event.type === "session.started") this.#values.set(event.sessionId, {});
    const value = this.#values.get(event.sessionId);
    if (!value) return;
    if (event.type === "budget") {
      if (event.budget.spent.costUsd !== undefined) value.cost = event.budget.spent.costUsd;
      else delete value.cost;
    }
  }
  get(id: string | undefined) {
    if (!id) return undefined;
    const talker = this.#values.get(id);
    const worker = this.#values.get(`${id}:worker`);
    const twin = this.#twin.get(id);
    const carry = this.#workerCarry.get(id);
    if (!worker && !twin) return talker;
    return {
      ...(talker?.cost === undefined ||
      (worker && worker.cost === undefined) ||
      (twin && !twin.known) ||
      (carry && !carry.known)
        ? {}
        : { cost: talker.cost + (worker?.cost ?? 0) + (twin?.cost ?? 0) + (carry?.cost ?? 0) }),
    };
  }
  delete(id: string): void {
    this.#values.delete(id);
    this.#values.delete(`${id}:worker`);
    this.#twin.delete(id);
    this.#workerCarry.delete(id);
    this.#tasks.delete(id);
  }
}
