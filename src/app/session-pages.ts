import type { Event } from "../core/types";
import { projectBranches } from "../store/events/branches";
import { pageSink } from "../store/pages";
import { sessionPaths } from "../store/paths";
import type { SessionStorage } from "./session-storage";

/** Archive reads share the same branch as model replay; new pages retain globally unique numbers. */
export function sessionPages(
  cwd: string,
  storage: SessionStorage,
  secrets: () => readonly string[],
) {
  return (sessionId: string, historySessionId = sessionId) =>
    pageSink(sessionPaths(cwd, sessionId), secrets, async () => {
      const { envelopes } = projectBranches(
        await storage.envelopes(historySessionId).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        }),
      );
      const pages = new Set<number>();
      for (const { event: source } of envelopes) {
        const event: Event =
          historySessionId === sessionId
            ? source
            : source.type === "worker.event"
              ? source.event
              : source;
        if (event.sessionId !== sessionId || event.type !== "context.compacted") continue;
        const page = event.page ?? event.contextSummary?.page;
        if (page) pages.add(page);
      }
      return pages;
    });
}
