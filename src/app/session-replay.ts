import type { Message } from "../core/types";
import { replaySkillActivations } from "../skills/replay";
import type { SkillActivations } from "../skills/tool";
import { restoreSessionMedia } from "../store/attachments";
import { projectBranches } from "../store/events/branches";
import { readTolerant } from "../store/events/envelope";
import { replayMessages } from "../store/events/replay";
import { sessionPaths } from "../store/paths";

/** Replay model history and its active skill restrictions from the same durable events. */
export async function sessionModelHistory(
  cwd: string,
  sessionId: string,
  activations: SkillActivations,
  storage?: { envelopes(id: string): Promise<import("../core/services/storage").EventEnvelope[]> },
): Promise<Message[]> {
  try {
    const envelopes = storage
      ? await storage.envelopes(sessionId)
      : (await readTolerant(sessionPaths(cwd, sessionId).events)).envelopes;
    const selected = projectBranches(envelopes).envelopes;
    activations.delete(sessionId);
    const workers = new Set(
      envelopes.flatMap(({ event }) =>
        event.type === "worker.event" && event.event.sessionId ? [event.event.sessionId] : [],
      ),
    );
    for (const workerId of workers) {
      activations.delete(workerId);
      replaySkillActivations(
        workerId,
        selected.flatMap(({ event }) =>
          event.type === "worker.event" && event.event.sessionId === workerId ? [event.event] : [],
        ),
        activations,
      );
    }
    replaySkillActivations(
      sessionId,
      selected.map(({ event }) => event),
      activations,
    );
    return restoreSessionMedia(cwd, sessionId, replayMessages(selected).messages);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
