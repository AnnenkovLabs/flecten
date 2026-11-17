<script lang="ts">
  import type { TwinCandidate } from "../../../../shared/twin";
  import { t } from "../../lib/i18n.svelte";
  import Select from "../controls/Select.svelte";
  let { trait, busy, onSave, onCancel }: { trait: TwinCandidate; busy: boolean; onSave: () => void; onCancel: () => void } = $props();
</script>

<form class="twin-edit-form" onsubmit={(event) => { event.preventDefault(); onSave(); }}>
  <label>{t("Trait title")}<input class="st-input" bind:value={trait.summary} required maxlength="300" /></label>
  <div class="twin-edit-reaction"><label>{t("Reaction")}<Select class="st-input" bind:value={trait.reaction} aria-label={t("Reaction")}
    options={[{ value: "anger", label: t("Anger") }, { value: "like", label: t("Like") }, { value: "delight", label: t("Delight") }]} /></label><label>{t("Strength")}<Select class="st-input" bind:value={trait.strength} aria-label={t("Strength")}
    options={[{ value: 1, label: t("Mild") }, { value: 2, label: t("Strong") }, { value: 3, label: t("Intense") }]} /></label></div>
  <label>{t("Your voice")}<textarea class="st-input" bind:value={trait.voice} maxlength="600" rows="2"></textarea></label>
  <label>{t("What this means for the Worker")}<textarea class="st-input" bind:value={trait.content} required maxlength="2000" rows="3"></textarea></label>
  <label>{t("Use this when")}<input class="st-input" bind:value={trait.appliesWhen} required maxlength="300" /></label>
  <div class="twin-actions"><button class="st-btn st-btn--primary" type="submit" disabled={busy}>{t("Save character")}</button><button class="st-btn st-btn--quiet" type="button" disabled={busy} onclick={onCancel}>{t("Cancel")}</button></div>
</form>
