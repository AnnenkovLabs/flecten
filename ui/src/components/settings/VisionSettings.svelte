<script lang="ts">
  import { canDescribeImages } from "../../../../shared/vision";
  import { t } from "../../lib/i18n.svelte";
  import type { HarnessSettings, ProviderInfo } from "../../lib/types";
  import ModelDefaultRow from "./ModelDefaultRow.svelte";

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
    <ModelDefaultRow title={t("Image description model")}
      description={t("Models without vision receive an image description and its local path. Auto chooses the lowest-priced vision model from the working provider, using input plus output prices.")}
      {providers} choice={config.vision?.model ? { ...config.vision, provider: config.vision.provider || config.provider } : undefined}
      inherit={t("Auto")} reasoningDefault="none" onChange={(choice) => { config.vision = choice ?? { provider: "", model: "" }; }} />
  </div>
</div>
