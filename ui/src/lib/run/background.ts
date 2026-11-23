import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import { finishedLabel } from "./sessions";
import { hasCheckpoint } from "./thread-artifacts";
import type { SessionEvent } from "./view.svelte";

/** Only actionable changes in a task behind the visible conversation interrupt the user. */
export function backgroundEvent(event: SessionEvent, title: string, refresh: () => void): void {
  switch (event.type) {
    case "session.finished":
      toast.show(`«${title}»: ${finishedLabel(event.result.stopReason)}`);
      return;
    case "approval.requested":
      toast.show(t("“{0}” is waiting for permission: {1}", [title, event.approval.tool]));
      return;
    case "job.finished":
      if (event.notify) toast.show(t("“{0}”: background command finished", [title]));
      if (event.checkpoint !== undefined) refresh();
      return;
    case "tool.finished":
      if (hasCheckpoint(event.result)) refresh();
      return;
  }
}
