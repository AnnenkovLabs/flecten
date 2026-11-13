import type { SessionPhase } from "../../../shared/session-state";
import { t } from "./i18n.svelte";

export type Phase = SessionPhase;

export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "idle":
      return t("done");
    case "running":
      return t("working");
    case "writing":
      return t("writing");
    case "stopped":
      return t("stopped");
    case "failed":
      return t("error");
  }
}

export function isBusy(phase: Phase): boolean {
  return phase === "running" || phase === "writing";
}
