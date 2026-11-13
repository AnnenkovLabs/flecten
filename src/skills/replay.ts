import { z } from "zod";
import type { Event } from "../core/types";
import type { SkillActivations } from "./tool";

const ActivationSchema = z.object({
  kind: z.literal("skill"),
  name: z.string().min(1),
  directory: z.string(),
  resources: z.array(z.string()),
  trust: z.enum(["trusted", "untrusted"]),
  allowedTools: z.array(z.string()),
  version: z.string().optional(),
  reused: z.boolean(),
});

/** Restrictions survive reopening because successful activations are durable tool events. */
export function replaySkillActivations(
  sessionId: string,
  events: readonly Event[],
  activations: SkillActivations,
): void {
  let session = activations.get(sessionId);
  for (const event of events) {
    if (event.type !== "tool.finished" || event.call.name !== "skill" || !event.result.ok) continue;
    const parsed = ActivationSchema.safeParse(event.result.data);
    if (!parsed.success) continue;
    session ??= new Map();
    const { reused: _reused, version, ...rest } = parsed.data;
    const data = { ...rest, ...(version === undefined ? {} : { version }) };
    session.set(data.name, { revision: "replayed", data, output: event.result.output });
  }
  if (session) activations.set(sessionId, session);
}
