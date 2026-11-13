import { t } from "./i18n.svelte";
import type { IconName } from "./icons";
import type { ModelInfo } from "./types";

interface ModelCapability {
  icon: IconName;
  label: string;
}

export function modelCapabilities(model: ModelInfo): ModelCapability[] {
  const input = model.modalities?.input ?? [];
  const capabilities: ModelCapability[] = [];
  if (model.reasoning) capabilities.push({ icon: "brain", label: t("Reasoning") });
  if (model.vision ?? input.includes("image")) {
    capabilities.push({ icon: "image", label: t("Images") });
  }
  if (model.pdf ?? input.includes("pdf")) capabilities.push({ icon: "file", label: "PDF" });
  if (model.audio ?? input.includes("audio")) capabilities.push({ icon: "mic", label: t("Audio") });
  return capabilities;
}
