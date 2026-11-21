<script lang="ts">
  import type { ModelChoice } from "../../../../shared/model-choice";
  import type { TwinStore } from "../../lib/twin.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import { REASONING_LABELS } from "../../lib/settings-utils";
  import type { ProviderInfo, ReasoningEffort } from "../../lib/types";
  import Icon from "../Icon.svelte";
  import ModelPicker from "../ModelPicker.svelte";
  import Select from "../controls/Select.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";

  let {
    twin,
    providers,
    defaultProvider,
    defaultModel,
  }: {
    twin: TwinStore;
    providers: ProviderInfo[];
    defaultProvider: string;
    defaultModel: string;
  } = $props();
  const snapshot = $derived(twin.snapshot);
  const state = $derived(twin.training ? "learning" : snapshot?.entries.length ? "ready" : "idle");
  const found = $derived(snapshot?.sources.reduce((total, source) => total + source.sessions, 0) ?? 0);
  const selected = $derived(snapshot?.sources.filter((source) => twin.selected.includes(source.id)).reduce((total, source) => total + source.sessions, 0) ?? 0);

  const usableProviders = $derived(
    providers
      .map((entry) => ({
        ...entry,
        models: Object.fromEntries(
          Object.entries(entry.models).filter(([, info]) => !info.disabled && info.tools !== false),
        ),
      }))
      .filter((entry) => Object.keys(entry.models).length > 0),
  );
  const choice = $derived<ModelChoice | undefined>(
    snapshot?.trainingModel ?? (defaultProvider && defaultModel ? { provider: defaultProvider, model: defaultModel } : undefined),
  );
  const activeModel = $derived(
    choice ? usableProviders.find((entry) => entry.id === choice.provider)?.models[choice.model] : undefined,
  );
  const hasReasoning = $derived(!!activeModel && activeModel.reasoning !== false && activeModel.reasoningMode !== "none");
  const toggle = $derived(activeModel?.reasoningMode === "toggle");
  const levels = $derived<ReasoningEffort[]>(
    toggle
      ? ["none", "medium"]
      : activeModel?.reasoningLevels?.length
        ? activeModel.reasoningLevels
        : ["low", "medium", "high"],
  );
  const variants = $derived(Object.entries(activeModel?.variants ?? {}));
  const fixedReasoning = $derived(activeModel?.variants?.[choice?.variant ?? ""]?.reasoning);

  function selectModel(provider: string, model: string): void {
    void twin.setTrainingModel({ provider, model });
  }

  function selectReasoning(value: string): void {
    if (!choice) return;
    const next: ModelChoice = { provider: choice.provider, model: choice.model };
    if (choice.variant) next.variant = choice.variant;
    if (value) next.reasoning = value as ReasoningEffort;
    void twin.setTrainingModel(next);
  }

  function selectVariant(value: string): void {
    if (!choice) return;
    const next: ModelChoice = { provider: choice.provider, model: choice.model };
    if (choice.reasoning) next.reasoning = choice.reasoning;
    if (value) next.variant = value;
    void twin.setTrainingModel(next);
  }
</script>

<div class="twin-source-layout">
  <section class="twin-stage" aria-label={t("Your Twin")}>
    <div class="twin-stage-status"><Icon name={twin.training ? "brain" : snapshot?.entries.length ? "check" : "spark"} size={14} /><span>{twin.training ? t("Learning from your decisions") : snapshot?.entries.length ? t("Ready to work with you") : t("Ready to learn")}</span></div>
    <div class="twin-portrait"><TwinCharacter {state} /></div>
    <div class="twin-stage-copy">
      <h2>{t("Same ideas. Same thoughts.")}</h2>
      <p>{t("Your taste, your standards, your voice. Twin answers the Worker and sends weak work back.")}</p>
      <div class="twin-topics"><span>{t("Anger")}</span><span>{t("Like")}</span><span>{t("Delight")}</span></div>
    </div>
  </section>

  <section class="twin-sources" aria-labelledby="twin-sources-title">
    <div class="twin-section-heading"><h2 id="twin-sources-title">{t("Sources")}</h2><span>{t("{0} sessions found", [found.toLocaleString(i18n.locale)])}</span></div>
    <p class="twin-hint">{t("Choose which agent histories and saved memories Twin can learn from.")}</p>
    <div class="twin-source-list">
      {#each snapshot?.sources ?? [] as source (source.id)}
        <div class="twin-source">
          <label class="twin-source-choice">
            <span class={`twin-source-mark source-${source.id}`} aria-hidden="true"><img src={`./twin/logos/${source.id}.${source.id === "opencode" ? "png" : "svg"}`} alt="" width="24" height="24" /></span>
            <span class="twin-source-name"><strong>{source.name}</strong><span data-tooltip={source.path}>{source.path}</span></span>
            <span class="twin-source-count">{source.status === "not-scanned" ? t("Scan first") : source.status === "missing" ? t("Not found") : source.status === "unsupported" ? t("Export needed") : source.sessions.toLocaleString(i18n.locale)}</span>
            <input type="checkbox" checked={twin.selected.includes(source.id)} disabled={twin.busy || twin.training || !source.available || source.sessions === 0} onchange={(event) => twin.toggleSource(source.id, event.currentTarget.checked)} aria-label={t("Learn from {0}", [source.name])} />
          </label>
          {#if source.warnings.length}<details class="twin-source-details"><summary>{t("Source details")}</summary>{#each source.warnings as warning}<p>{warning}</p>{/each}</details>{/if}
        </div>
      {/each}
    </div>

    {#if usableProviders.length > 0}
      <div class="twin-model-config">
        <div class="twin-model-field">
          <span class="twin-model-label">{t("Training model")}</span>
          <ModelPicker
            providers={usableProviders}
            provider={choice?.provider ?? ""}
            model={choice?.model ?? ""}
            ariaLabel={t("Training model")}
            disabled={twin.busy || twin.training}
            onSelect={selectModel}
          />
        </div>
        <div class="twin-model-field">
          <span class="twin-model-label">{t("Reasoning level")}</span>
          <Select
            class="st-input"
            aria-label={t("Training reasoning level")}
            disabled={twin.busy || twin.training || !hasReasoning || !!fixedReasoning}
            value={hasReasoning ? fixedReasoning ?? choice?.reasoning ?? "" : ""}
            onchange={selectReasoning}
            options={hasReasoning ? [
              { value: "", label: t("Model default") },
              ...(fixedReasoning && !levels.includes(fixedReasoning) ? [{ value: fixedReasoning, label: REASONING_LABELS[fixedReasoning] ?? fixedReasoning }] : []),
              ...levels.map((level) => ({ value: level, label: toggle ? (level === "none" ? t("Off") : t("Enabled")) : REASONING_LABELS[level] ?? level })),
            ] : [{ value: "", label: activeModel ? t("Reasoning is not supported") : t("Select a model first") }]}
          />
        </div>
        {#if variants.length > 0}
          <div class="twin-model-field">
            <span class="twin-model-label">{t("Model variant")}</span>
            <Select
              class="st-input"
              aria-label={t("Training model variant")}
              disabled={twin.busy || twin.training}
              value={choice?.variant ?? ""}
              onchange={selectVariant}
              options={[{ value: "", label: t("Default variant") }, ...variants.map(([id, variant]) => ({ value: id, label: variant.name ?? id }))]}
            />
          </div>
        {/if}
      </div>
    {/if}

    {#if twin.training}
      <div class="twin-training" role="status">
        <strong>{snapshot?.training.state === "reading" ? t("Reading selected sessions…") : t("Learning from your decisions")}</strong>
        <p>{t("Read {0} sessions and {1} messages", [snapshot?.training.sessions ?? 0, snapshot?.training.messages ?? 0])}</p>
        <progress aria-label={t("Training Twin")}></progress>
        <button class="st-btn st-btn--quiet" type="button" onclick={() => twin.cancel()}>{t("Cancel training")}</button>
      </div>
    {:else}
      <div class="twin-source-actions">
        <button class="st-btn st-btn--primary" type="button" disabled={twin.busy || selected === 0} onclick={() => twin.train()}><Icon name="spark" size={16} />{t("Train Twin")}</button>
        <button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => twin.load(true)}><Icon name="refresh" size={14} />{twin.busy ? t("Scanning…") : t("Scan sources")}</button>
      </div>
      <p class="twin-cost-warning">
        <Icon name="mark" size={13} />
        <span>{t("Training reads all unread sessions and saved harness memories in batches and may consume significant API tokens and funds.")}</span>
      </p>
      {#if snapshot?.training.state === "ready"}
        <p class="twin-hint" role="status">{snapshot.training.messages === 0 ? t("No new supported user messages were found. No model request was made.") : snapshot.entries.length === 0 ? t("Training finished. No supported traits were found.") : t("Twin is ready. Learned traits apply immediately and you can edit them.")} {#if snapshot.entries.length}<button class="twin-text-button" type="button" onclick={() => twin.tab = "profile"}>{t("View your character")}</button>{/if}</p>
      {:else if snapshot?.training.state === "cancelled"}<p class="twin-hint" role="status">{t("Training cancelled. Your existing character is unchanged.")}</p>{/if}
    {/if}
    <details class="twin-privacy"><summary>{t("What is sent to the model?")}</summary><p>{t("Scanning is local. Learning sends your messages, saved harness memories, and preceding agent replies to the selected provider.")}</p><p>{t("Training model: {0} / {1}", [choice?.provider || snapshot?.training.provider || "…", choice?.model || snapshot?.training.model || "…"])}</p></details>
  </section>
</div>
