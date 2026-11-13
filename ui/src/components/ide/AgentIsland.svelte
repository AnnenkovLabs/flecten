<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { RunStore } from "../../lib/run.svelte";
  import { formatModelName } from "../../lib/model-name";
  import Icon from "../Icon.svelte";
  import Toast from "../Toast.svelte";
  let { run, expanded, onToggle }: { run: RunStore; expanded: boolean; onToggle: () => void } = $props();
  const approvals = $derived(run.view.thread.items.filter((item) => item.kind === "approval" && item.state === "pending").length);
</script>
<div class="island-dock">
  <Toast />
  <section class="agent-island" aria-label={t("Agent island")}>
    <button class="island-toggle" type="button" title={expanded ? t("Hide agent panel") : t("Open agent panel")} aria-expanded={expanded} aria-controls="ide-agent" onclick={onToggle}>
      <span class="agent-symbol" class:busy={run.busy}><Icon name="brain" size={18} /></span><strong>{t("Agent")}</strong>
      <span class="activity">{approvals ? t("Waiting for permission: {0}", [approvals]) : run.busy ? run.view.liveLabel || t("Working…") : expanded ? t("Conversation on the right") : t("Message the agent…")}</span>
      <span class="model">{formatModelName(run.model)}</span><Icon name={expanded ? "chevron-right" : "arrow-up"} size={14} />
    </button>
    {#if run.busy}<button class="island-action" class:is-stopping={run.view.stopping} type="button" aria-label={run.view.stopping ? t("Force stop agent") : t("Stop agent")} title={run.view.stopping ? t("Stop immediately") : t("Stop after the current step")} onclick={() => run.stop()}><Icon name="stop" size={15} /></button>{/if}
  </section>
</div>
<style>
  .island-dock { position: relative; flex: none; width: 100%; }
  .agent-island { display: flex; align-items: center; min-height: 32px; padding-inline: 8px; background: var(--surface); }
  .island-toggle { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 32px; padding-inline: 6px; text-align: start; border-radius: 4px; }
  .island-toggle:hover { background: var(--raised); }
  .agent-symbol { display: grid; place-items: center; color: var(--text-2); } .agent-symbol.busy { color: var(--primary); }
  strong { font-size: 12px; font-weight: 600; } .activity { overflow: hidden; flex: 1; color: var(--muted); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; } .model { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
  .island-action { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 4px; color: var(--muted); } .island-action:hover { background: var(--raised); color: var(--text); }
  .island-action.is-stopping, .island-action.is-stopping:hover { background: var(--error); color: var(--bg); }
  @media(max-width: 1220px) { .model { display: none; } }
</style>
