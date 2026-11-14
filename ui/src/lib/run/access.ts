import type { AccessMode } from "../../../../shared/access-mode";
import { requestAgent, sendAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { accessModeLabel } from "../permissions";
import { toast } from "../toast.svelte";
import type { AgentInfo } from "../types";

/** Quick access changes leave an open settings draft intact. */
export async function chooseAccessMode(
  host: { info: AgentInfo | null; accessChanging: boolean },
  mode: AccessMode,
): Promise<void> {
  if (host.accessChanging || !host.info) return;
  host.accessChanging = true;
  try {
    const response = await requestAgent({ type: "access.set", mode }, 15_000);
    if (response.info) host.info = response.info;
    sendAgent({ type: "status" });
    toast.show(t("Access mode: {0}", [accessModeLabel(mode)]));
  } catch (error) {
    toast.error(
      t("Could not change access. Try again. {0}", [
        error instanceof Error ? error.message : String(error),
      ]),
    );
  } finally {
    host.accessChanging = false;
  }
}
