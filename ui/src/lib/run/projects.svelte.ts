import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import type { AgentInfo, AgentSessionSummary, Project, TaskStatusKind } from "../types";
import { taskStatus } from "../ui-polish";
import { projectTasks } from "./sessions";

export interface ProjectSessions {
  path: string;
  projectRoot: string | null;
  name: string;
  trust: "unknown" | "trusted" | "untrusted";
  sessions: AgentSessionSummary[];
  error?: string;
}

export class Projects {
  entries = $state<ProjectSessions[]>([]);
  #revision = 0;
  async refresh(): Promise<void> {
    const revision = ++this.#revision;
    try {
      const response = await requestAgent({ type: "projects.list" });
      if (revision === this.#revision) this.entries = response.projects ?? [];
    } catch {
      /* A disconnected sidecar is reported by the connection state. */
    }
  }
  groups(
    info: AgentInfo | null,
    sessions: AgentSessionSummary[],
    status: (session: AgentSessionSummary) => TaskStatusKind,
  ): Project[] {
    if (!info) return [];
    const entries = this.entries.length
      ? this.entries
      : [
          {
            path: info.cwd,
            projectRoot: info.projectRoot === undefined ? info.cwd : info.projectRoot,
            name: info.project,
            trust: info.trustState ?? ("unknown" as const),
            sessions,
          },
        ];
    return entries.map((entry) => {
      const current = entry.path === info.cwd;
      const list = current ? sessions : entry.sessions;
      const name = entry.projectRoot === null ? t("Without a project") : entry.name;
      const group = projectTasks(
        list,
        name,
        current
          ? status
          : (session) =>
              taskStatus(session.stopReason, {
                running: session.running ?? false,
                interrupted: session.interrupted ?? false,
                approvals: 0,
              }),
      )[0];
      return {
        ...group,
        id: entry.path,
        path: entry.path,
        projectRoot: entry.projectRoot,
        name,
        current,
        trust: entry.trust,
        ...(entry.error ? { error: entry.error } : {}),
      } as Project;
    });
  }
}
