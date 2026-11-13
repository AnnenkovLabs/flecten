import type { Message } from "../core/types";
import { replaySkillActivations } from "../skills/replay";
import type { SkillActivations } from "../skills/tool";
import { restoreSessionMedia } from "../store/attachments";
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
    replaySkillActivations(
      sessionId,
      envelopes.map(({ event }) => event),
      activations,
    );
    return restoreSessionMedia(cwd, sessionId, replayMessages(envelopes).messages);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
