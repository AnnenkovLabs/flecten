import type { ModelChoice, ModelSelected } from "../../../../shared/model-choice";
import type { AgentEvent } from "../agent-protocol";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { hasStoredReasoning, storedReasoning, storeReasoning } from "../run-helpers";
import { toast } from "../toast.svelte";
import type { AgentInfo, ReasoningChoice } from "../types";

export interface ModelHost {
  info: AgentInfo | null;
  reasoning: ReasoningChoice;
  variant: string | undefined;
  sessionId(): string | null;
  ensureSession(): string;
}

interface ChatChoice {
  value: ModelChoice;
  confirmed: ModelChoice;
  revision: number;
  pending: number;
  ready: Promise<void>;
}

/** The catalog is global; the next-run model, reasoning and variant belong to one chat. */
export class RunModels {
  #defaults: AgentInfo | null = null;
  #choices = new Map<string, ChatChoice>();
  #sequence = 0;
  #preferredReasoning = hasStoredReasoning() ? storedReasoning() : undefined;

  constructor(private readonly host: ModelHost) {}

  reset(): void {
    this.#defaults = null;
    this.#choices.clear();
  }

  ready(id: string | null): Promise<void> {
    return (id && this.#choices.get(id)?.ready) || Promise.resolve();
  }

  pending(id: string): boolean {
    return (this.#choices.get(id)?.pending ?? 0) > 0;
  }

  revision(id: string): number {
    return this.#choices.get(id)?.revision ?? 0;
  }

  reasoningFor(id: string): ReasoningChoice {
    return this.#choices.get(id)?.value.reasoning ?? "auto";
  }

  focus(id: string | null): void {
    if (id && !this.#choices.has(id) && this.#defaults) {
      this.#choices.set(id, this.#entry(this.#defaultChoice()));
    }
    this.#project();
  }

  status(info: AgentInfo): void {
    if (!info.sessionId) this.#defaults = info;
    else if (!this.#choices.get(info.sessionId)?.pending) {
      this.#choices.set(info.sessionId, this.#entry(this.#choice(info)));
    }
    this.#project();
  }

  restore(id: string, events: AgentEvent[], info?: AgentInfo, revision?: number): void {
    if (
      this.#choices.get(id)?.pending ||
      (revision !== undefined && revision !== this.revision(id))
    )
      return;
    const latest = [...events].reverse();
    const selected = latest.find(
      (event): event is Extract<AgentEvent, { type: "model.selected" }> =>
        event.type === "model.selected",
    );
    const started = latest.find(
      (event): event is Extract<AgentEvent, { type: "session.started" }> =>
        event.type === "session.started" && !event.internal && event.role !== "worker",
    );
    const source = info ?? selected ?? started;
    if (source && "provider" in source && "model" in source) {
      this.#choices.set(id, this.#entry(this.#choice(source)));
    }
    this.#project();
  }

  selected(event: ModelSelected): void {
    if (this.#choices.get(event.sessionId)?.pending) return;
    this.#choices.set(event.sessionId, this.#entry(this.#choice(event)));
    this.#project();
  }

  choose(provider: string, model: string): Promise<void> {
    const id = this.host.ensureSession();
    const reasoning = this.host.reasoning;
    const metadata = this.host.info?.providers.find((entry) => entry.id === provider)?.models[
      model
    ];
    const supported =
      reasoning === "auto" ||
      (metadata?.reasoningMode !== "toggle" &&
        (!metadata?.reasoningLevels?.length || metadata.reasoningLevels.includes(reasoning))) ||
      (metadata?.reasoningMode === "toggle" && reasoning === "none");
    return this.#save(
      id,
      {
        provider,
        model,
        ...(supported && reasoning !== "auto" ? { reasoning } : {}),
      },
      true,
    );
  }

  variant(value: string | undefined): Promise<void> {
    const id = this.host.ensureSession();
    const choice = this.#choices.get(id)?.value;
    if (!choice) return Promise.resolve();
    return this.#save(id, { ...choice, variant: value });
  }

  reasoning(value: ReasoningChoice): Promise<void> {
    storeReasoning(value);
    this.#preferredReasoning = value;
    const id = this.host.ensureSession();
    const choice = this.#choices.get(id)?.value;
    if (!choice) {
      this.host.reasoning = value;
      return Promise.resolve();
    }
    return this.#save(id, { ...choice, reasoning: value === "auto" ? undefined : value });
  }

  #save(id: string, value: ModelChoice, announce = false): Promise<void> {
    const entry = this.#choices.get(id) ?? this.#entry(value);
    const revision = ++this.#sequence;
    entry.revision = revision;
    entry.value = value;
    entry.pending++;
    this.#choices.set(id, entry);
    this.#project();
    // Serialize a chat's choices so an older command cannot become its final backend value.
    entry.ready = entry.ready.then(async () => {
      if (this.#choices.get(id) !== entry) return;
      try {
        const response = await requestAgent({
          type: "model.set",
          sessionId: id,
          provider: value.provider,
          model: value.model,
          ...(value.reasoning ? { reasoning: value.reasoning } : {}),
          ...(value.variant ? { variant: value.variant } : {}),
        });
        if (this.#choices.get(id) !== entry) return;
        entry.confirmed = response.info ? this.#choice(response.info) : value;
        if (entry.revision !== revision) return;
        entry.value = entry.confirmed;
        if (announce && this.host.sessionId() === id) toast.show(t("Model: {0}", [value.model]));
      } catch (error) {
        if (this.#choices.get(id) !== entry || entry.revision !== revision) return;
        entry.value = entry.confirmed;
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        entry.pending--;
        this.#project();
      }
    });
    return entry.ready;
  }

  #entry(value: ModelChoice): ChatChoice {
    return {
      value,
      confirmed: value,
      revision: ++this.#sequence,
      pending: 0,
      ready: Promise.resolve(),
    };
  }

  #choice(source: ModelChoice): ModelChoice {
    return {
      provider: source.provider,
      model: source.model,
      reasoning: source.reasoning,
      variant: source.variant,
    };
  }

  #defaultChoice(): ModelChoice {
    const choice = this.#choice(this.#defaults as AgentInfo);
    if (this.#preferredReasoning !== undefined) {
      choice.reasoning = this.#preferredReasoning === "auto" ? undefined : this.#preferredReasoning;
    }
    return choice;
  }

  #project(): void {
    const base = this.#defaults;
    if (!base) return;
    const id = this.host.sessionId();
    const choice = (id && this.#choices.get(id)?.value) || this.#defaultChoice();
    const model = base.providers.find((entry) => entry.id === choice.provider)?.models[
      choice.model
    ];
    const info: AgentInfo = {
      ...base,
      provider: choice.provider,
      model: choice.model,
      ...(id ? { sessionId: id } : {}),
      contextWindow: model?.context ?? base.contextWindow,
      maxOutputTokens: model?.output ?? base.maxOutputTokens,
    };
    if (choice.reasoning === undefined) delete info.reasoning;
    else info.reasoning = choice.reasoning;
    if (choice.variant === undefined) delete info.variant;
    else info.variant = choice.variant;
    this.host.info = info;
    this.host.reasoning = choice.reasoning ?? "auto";
    this.host.variant = choice.variant;
  }
}
