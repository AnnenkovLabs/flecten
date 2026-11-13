import { link, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ModuleIdSchema } from "../../shared/modules";
import type { Message } from "../core/types";
import { atomicWrite } from "../util/atomic";

const State = z
  .object({ schemaVersion: z.literal(1), requested: z.array(ModuleIdSchema).max(32) })
  .strict();
function statePath(cwd: string, sessionId: string): string {
  if (
    !sessionId ||
    sessionId.length > 200 ||
    ![...sessionId].every(
      (c) =>
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c === "_" ||
        c === "-",
    )
  )
    throw new Error("Invalid module session id");
  return join(cwd, ".liquid", "sessions", sessionId, "modules.json");
}
async function savedModuleState(cwd: string, sessionId: string): Promise<string[] | undefined> {
  try {
    const file = Bun.file(statePath(cwd, sessionId));
    if (file.size > 16_000) throw new Error("Module session state exceeds 16 KB");
    return State.parse(await file.json()).requested;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

/** Preserve legacy participant activations only when the shared owner has never saved state. */
export async function inheritModuleState(
  cwd: string,
  ownerId: string,
  participantId: string,
): Promise<void> {
  if ((await savedModuleState(cwd, ownerId)) !== undefined) return;
  const requested = await savedModuleState(cwd, participantId);
  if (requested === undefined) return;
  const path = statePath(cwd, ownerId);
  const temporary = `${path}.${crypto.randomUUID()}.migration`;
  try {
    await atomicWrite(temporary, JSON.stringify({ schemaVersion: 1, requested }), 0o600);
    // Publish the complete file without replacing state saved concurrently, including an empty set.
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadModuleState(
  cwd: string,
  sessionId: string,
  history: readonly Message[],
): Promise<string[]> {
  const requested = await savedModuleState(cwd, sessionId);
  if (requested !== undefined) return requested;
  // Forks inherit typed deliveries from their transcript, never parsed prose.
  const last = history.findLast(
    (message) => message.role !== "assistant" && message.moduleReferences !== undefined,
  );
  return last && last.role !== "assistant"
    ? (last.moduleReferences ?? []).filter((ref) => ref.requested).map((ref) => ref.name)
    : [];
}
export function saveModuleState(
  cwd: string,
  sessionId: string,
  requested: string[],
  signal: AbortSignal,
): Promise<void> {
  return atomicWrite(
    statePath(cwd, sessionId),
    JSON.stringify(State.parse({ schemaVersion: 1, requested })),
    0o600,
    signal,
  );
}
