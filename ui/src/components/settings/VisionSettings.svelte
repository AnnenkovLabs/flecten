<script lang="ts">
  import { canDescribeImages } from "../../../../shared/vision";
  import { t } from "../../lib/i18n.svelte";
  import type { HarnessSettings, ProviderInfo } from "../../lib/types";
  import ModelPicker from "../ModelPicker.svelte";
  import SettingsRow from "./SettingsRow.svelte";

  let { config }: { config: HarnessSettings } = $props();
  const providers = $derived<ProviderInfo[]>(Object.entries(config.providers).map(([id, provider]) => ({
    id, name: provider.name || id, protocol: provider.protocol, baseUrl: provider.baseUrl,
    apiKeySet: false, active: false,
    models: Object.fromEntries(Object.entries(provider.models).filter(([, model]) => canDescribeImages(model) && !model.disabled)),
  })).filter((provider) => Object.keys(provider.models).length > 0));
</script>

<div class="st-group vision-settings">
  <h3 class="st-group-title">{t("Image understanding")}</h3>
  <div class="st-card">
    <SettingsRow title={t("Image description model")}
      description={t("Models without vision receive an image description and its local path. Auto chooses the lowest-priced vision model from the working provider, using input plus output prices.")}>
      <ModelPicker {providers} provider={config.vision?.provider || config.provider}
        model={config.vision?.model || ""} placeholder={t("Auto")}
        ariaLabel={t("Image description model")}
        onSelect={(provider, model) => { config.vision = { provider, model }; }} />
      {#if config.vision?.model}
        <button class="st-btn" type="button" onclick={() => { config.vision = { provider: "", model: "" }; }}>{t("Auto")}</button>
      {/if}
    </SettingsRow>
  </div>
</div>
