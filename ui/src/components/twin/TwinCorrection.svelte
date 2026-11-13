<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { correctionExamples, type IdeTwinCorrection } from "../../lib/ide/twin-correction.svelte";
  import Icon from "../Icon.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";

  let { correction, path }: { correction: IdeTwinCorrection; path: string } = $props();
  const edit = $derived(correction.pending?.path === path ? correction.pending : null);
  const examples = $derived(edit ? correctionExamples(edit.before, edit.after) : null);
  let rule = $state("");
  let appliesWhen = $state("");
  let opened = $state(false);
  $effect(() => { if (edit?.id) { rule = ""; appliesWhen = ""; opened = false; } });
</script>

{#if edit}
  <div class="twin-correction">
    <details bind:open={opened}>
      <summary><TwinCharacter compact /><strong>{t("Teach Twin")}</strong><span>{t("From this saved edit")}</span><Icon name="chevron-down" size={14} /></summary>
      <form aria-label={t("Teach Twin from this edit")} onsubmit={(event) => { event.preventDefault(); if (edit) void correction.teach(edit.id, rule, appliesWhen); }}>
        <p>{t("Save a rule for future work. No model call is needed.")}</p>
        <label class="st-field"><span>{t("Rule for future work")}</span><textarea class="st-input" rows="2" maxlength="2000" required bind:value={rule} placeholder={t("For example: use logger.info instead of console.log.")} disabled={correction.busy}></textarea></label>
        <label class="st-field"><span>{t("Apply when")}</span><input class="st-input" maxlength="300" required bind:value={appliesWhen} placeholder={t("For example: adding logs in this project")} disabled={correction.busy} /></label>
        {#if examples}<details class="edit-example"><summary>{t("View saved edit")}</summary><div class="edit-pair"><div><span>{t("Before edit")}</span><pre>{examples.before}</pre></div><div><span>{t("After edit")}</span><pre>{examples.after}</pre></div></div></details>{/if}
        {#if correction.error}<p class="correction-error" role="alert">{t("Could not teach Twin. Review the rule and try again.")} {correction.error}</p>{/if}
        <div class="correction-actions"><button class="st-btn st-btn--primary st-btn--sm" type="submit" disabled={correction.busy || !rule.trim() || !appliesWhen.trim()}>{correction.busy ? t("Saving rule…") : t("Save rule to Twin")}</button><button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={correction.busy} onclick={() => { if (edit) correction.dismiss(edit.id); }}>{t("Skip this edit")}</button></div>
      </form>
    </details>
    <button class="dismiss" type="button" aria-label={t("Skip this edit")} title={t("Skip this edit")} disabled={correction.busy} onclick={() => { if (edit) correction.dismiss(edit.id); }}><Icon name="x" size={14} /></button>
  </div>
{:else if correction.taughtPath === path}
  <p class="twin-saved" role="status"><Icon name="check" size={14} />{t("Rule saved to Twin.")}</p>
{/if}

<style>
  .twin-correction { position: relative; flex: none; border-top: 1px solid var(--line); background: var(--surface); font-size: 12px; }
  .twin-correction > details > summary { display: flex; gap: var(--space-2); align-items: center; min-height: 40px; padding: var(--space-1) 44px var(--space-1) var(--space-3); cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary strong { font-weight: 600; color: var(--text); }
  summary > span { color: var(--muted); min-width: 0; }
  summary :global(svg) { margin-left: auto; flex: none; }
  .dismiss { position: absolute; right: 0; top: 0; display: grid; place-items: center; width: 40px; height: 40px; border: 0; background: none; color: var(--muted); cursor: pointer; }
  form { display: grid; gap: var(--space-3); padding: 0 var(--space-3) var(--space-3); max-height: 42vh; overflow: auto; }
  form > p { color: var(--text-2); margin: 0; line-height: 1.5; }
  .st-field { gap: var(--space-1); }
  .st-input { font-size: 13px; min-width: 0; resize: vertical; }
  .edit-example > summary { padding: var(--space-1) 0; color: var(--text-2); cursor: pointer; }
  .edit-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin-top: var(--space-2); }
  .edit-pair span { color: var(--muted); }
  pre { margin: var(--space-1) 0 0; padding: var(--space-2); background: var(--bg); white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 11px; line-height: 1.5; max-height: 160px; overflow: auto; }
  .correction-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  form > .correction-error { color: var(--error); overflow-wrap: anywhere; }
  .twin-saved { display: flex; align-items: center; gap: var(--space-2); flex: none; margin: 0; padding: var(--space-2) var(--space-3); min-height: 40px; border-top: 1px solid var(--line); color: var(--text-2); font-size: 12px; }
  summary:focus-visible, .dismiss:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 4px; }
  @container (max-width: 380px) { summary > span { display: none; } .edit-pair { grid-template-columns: 1fr; } }
</style>
