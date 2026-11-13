import type { MessageKey } from "./i18n/catalogs";
import { t } from "./i18n.svelte";

export function subagentRole(agent: string): string {
  const roles: Record<string, MessageKey> = {
    explore: "Researcher",
    implement: "Developer",
    review: "Reviewer",
  };
  return Object.hasOwn(roles, agent) ? t(roles[agent] as MessageKey) : agent;
}
export function subagentStatus(status: string): string {
  const labels: Record<string, MessageKey> = {
    running: "Running",
    succeeded: "Finished",
    failed: "Failed",
    stopped: "Stopped",
    interrupted: "Interrupted",
  };
  return Object.hasOwn(labels, status) ? t(labels[status] as MessageKey) : "";
}
