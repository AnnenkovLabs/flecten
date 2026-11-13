<script lang="ts">
  import type { TwinCandidate } from "../../../../shared/twin";
  import { t } from "../../lib/i18n.svelte";
  let { trait, busy, onSave, onCancel }: { trait: TwinCandidate; busy: boolean; onSave: () => void; onCancel: () => void } = $props();
</script>

<form class="twin-edit-form" onsubmit={(event) => { event.preventDefault(); onSave(); }}>
  <label>{t("Trait title")}<input class="st-input" bind:value={trait.summary} required maxlength="300" /></label>
  <div class="twin-edit-reaction"><label>{t("Reaction")}<select class="st-input" bind:value={trait.reaction}><option value="anger">{t("Anger")}</option><option value="like">{t("Like")}</option><option value="delight">{t("Delight")}</option></select></label><label>{t("Strength")}<select class="st-input" bind:value={trait.strength}><option value={1}>{t("Mild")}</option><option value={2}>{t("Strong")}</option><option value={3}>{t("Intense")}</option></select></label></div>
  <label>{t("Your voice")}<textarea class="st-input" bind:value={trait.voice} maxlength="600" rows="2"></textarea></label>
  <label>{t("What this means for the Worker")}<textarea class="st-input" bind:value={trait.content} required maxlength="2000" rows="3"></textarea></label>
  <label>{t("Use this when")}<input class="st-input" bind:value={trait.appliesWhen} required maxlength="300" /></label>
  <div class="twin-actions"><button class="st-btn st-btn--primary" type="submit" disabled={busy}>{t("Save character")}</button><button class="st-btn st-btn--quiet" type="button" disabled={busy} onclick={onCancel}>{t("Cancel")}</button></div>
</form>
