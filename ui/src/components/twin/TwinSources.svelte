<script lang="ts">
  import type { TwinStore } from "../../lib/twin.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";

  let { twin }: { twin: TwinStore } = $props();
  const snapshot = $derived(twin.snapshot);
  const state = $derived(twin.training ? "learning" : snapshot?.entries.length ? "ready" : "idle");
  const found = $derived(snapshot?.sources.reduce((total, source) => total + source.sessions, 0) ?? 0);
  const selected = $derived(snapshot?.sources.filter((source) => twin.selected.includes(source.id)).reduce((total, source) => total + source.sessions, 0) ?? 0);
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
    <p class="twin-hint">{t("Choose which agent histories Twin can learn from.")}</p>
    <div class="twin-source-list">
      {#each snapshot?.sources ?? [] as source (source.id)}
        <div class="twin-source">
          <label class="twin-source-choice">
            <span class={`twin-source-mark source-${source.id}`} aria-hidden="true"><img src={`./twin/logos/${source.id}.${source.id === "opencode" ? "png" : "svg"}`} alt="" width="24" height="24" /></span>
            <span class="twin-source-name"><strong>{source.name}</strong><span title={source.path}>{source.path}</span></span>
            <span class="twin-source-count">{source.status === "not-scanned" ? t("Scan first") : source.status === "missing" ? t("Not found") : source.status === "unsupported" ? t("Export needed") : source.sessions.toLocaleString(i18n.locale)}</span>
            <input type="checkbox" checked={twin.selected.includes(source.id)} disabled={twin.busy || twin.training || !source.available || source.sessions === 0} onchange={(event) => twin.toggleSource(source.id, event.currentTarget.checked)} aria-label={t("Learn from {0}", [source.name])} />
          </label>
          {#if source.warnings.length}<details class="twin-source-details"><summary>{t("Source details")}</summary>{#each source.warnings as warning}<p>{warning}</p>{/each}</details>{/if}
        </div>
      {/each}
    </div>

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
      {#if snapshot?.training.state === "ready"}
        <p class="twin-hint" role="status">{t("Twin is ready. Learned traits apply immediately and you can edit them.")} <button class="twin-text-button" type="button" onclick={() => twin.tab = "profile"}>{t("View your character")}</button></p>
      {:else if snapshot?.training.state === "cancelled"}<p class="twin-hint" role="status">{t("Training cancelled. Your existing character is unchanged.")}</p>{/if}
    {/if}
    <details class="twin-privacy"><summary>{t("What is sent to the model?")}</summary><p>{t("Scanning is local. Learning sends your messages and preceding agent replies to your configured provider, within the limits below.")}</p><p>{t("Training model: {0} / {1}", [snapshot?.training.provider || "…", snapshot?.training.model || "…"])}</p><p>{t("Per training: up to {0} sessions, {1} messages and {2} characters", [snapshot?.limits.maxSessions ?? 0, snapshot?.limits.maxMessages ?? 0, snapshot?.limits.maxInputCharacters ?? 0])}</p></details>
  </section>
</div>
