<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { ProviderSettings } from "../lib/types";

  let { provider }: { provider: ProviderSettings } = $props();
  const id = $props.id();
</script>

<section class="provider-protection" aria-labelledby={`${id}-title`}>
  <h2 class="st-title" id={`${id}-title`}>{t("Provider protection")}</h2>
  <label class="st-switch">
    <span class="st-switch-copy">
      <strong id={`${id}-label`}>{t("Hide keys and passwords from this API")}</strong>
      <span id={`${id}-hint`}>{t("Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.")}</span>
    </span>
    <input
      type="checkbox"
      role="switch"
      checked={provider.protection?.enabled ?? false}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      onchange={(event) => { provider.protection = { ...provider.protection, enabled: event.currentTarget.checked }; }}
    />
    <span class="st-switch-track" aria-hidden="true"></span>
  </label>
  <p class="st-hint">{t("The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.")}</p>
</section>

<style>
  .provider-protection { display: grid; gap: 12px; margin-block-end: 24px; }
</style>
