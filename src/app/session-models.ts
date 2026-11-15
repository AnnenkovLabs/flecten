import { type ModelChoice, ModelChoiceSchema } from "../../shared/model-choice";
import type { HarnessConfig } from "../config/schema";
import type { Event } from "../core/types";
import { assertSessionId } from "../store/events/index";
import type { SessionStorage } from "./session-storage";

/** A chat keeps its explicit choice, or the model its saved runs already used. */
export function sessionModels(storage: SessionStorage) {
  const choices = new Map<string, ModelChoice>();
  const loaded = new Map<string, Promise<void>>();
  let writes = Promise.resolve();

  const load = (id: string): Promise<void> => {
    assertSessionId(id);
    let pending = loaded.get(id);
    if (!pending) {
      pending = (async () => {
        let selected: ModelChoice | undefined;
        let started: ModelChoice | undefined;
        for (const { event } of await storage.envelopes(id)) {
          if (event.type === "model.selected") selected = ModelChoiceSchema.parse(event);
          if (event.type === "session.started" && event.role !== "worker")
            started = ModelChoiceSchema.parse(event);
        }
        const choice = selected ?? started;
        if (choice && !choices.has(id)) choices.set(id, choice);
      })();
      loaded.set(id, pending);
      void pending.catch(() => loaded.delete(id));
    }
    return pending;
  };
  return {
    load,
    config(config: HarnessConfig, id?: string): HarnessConfig {
      const choice = id ? choices.get(id) : undefined;
      return choice ? withModelChoice(config, choice) : config;
    },
    note(event: Event) {
      if (
        event.type === "session.started" &&
        event.role !== "worker" &&
        !choices.has(event.sessionId)
      )
        choices.set(event.sessionId, ModelChoiceSchema.parse(event));
    },
    select(id: string, input: ModelChoice) {
      const choice = ModelChoiceSchema.parse(input);
      const next = writes.then(async () => {
        await load(id);
        const event = { type: "model.selected" as const, sessionId: id, ...choice };
        await storage.persist(event);
        choices.set(id, choice);
        return event;
      });
      writes = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    settled: () => writes,
  };
}

export function withModelChoice(config: HarnessConfig, input: ModelChoice): HarnessConfig {
  const choice = ModelChoiceSchema.parse(input);
  const next = { ...config, provider: choice.provider, model: choice.model };
  if (choice.reasoning) next.reasoning = choice.reasoning;
  else delete next.reasoning;
  if (choice.variant) next.variant = choice.variant;
  else delete next.variant;
  return next;
}

export function validateModelChoice(config: HarnessConfig, choice: ModelChoice): void {
  const definition = config.providers[choice.provider];
  if (!definition) throw new Error(`unknown provider: ${choice.provider}`);
  if (!definition.models[choice.model] && Object.keys(definition.models).length > 0)
    throw new Error(`unknown model for ${choice.provider}: ${choice.model}`);
}
