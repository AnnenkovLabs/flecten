import { type FileHandle, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ModelChoiceSchema } from "../../shared/model-choice";
import {
  type TwinCandidate,
  TwinCandidateSchema,
  TwinEntrySchema,
  type TwinSnapshot,
  TwinSourceIdSchema,
  TwinUsageSchema,
} from "../../shared/twin";
import { memoryDigest } from "../core/memory/sources";
import { atomicWrite } from "../util/atomic";
import { Mutex } from "../util/mutex";

export const idleTraining = (): TwinSnapshot["training"] => ({
  state: "idle",
  message: "",
  sessions: 0,
  messages: 0,
  usage: { input: 0, output: 0, cached: 0 },
  provider: "",
  model: "",
});
const training = z.object({
  state: z.enum(["idle", "reading", "learning", "ready", "cancelled", "error"]),
  message: z.string().max(2000),
  sessions: z.number().int().min(0),
  messages: z.number().int().min(0),
  usage: TwinUsageSchema,
  provider: z.string(),
  model: z.string(),
});
const StateSchema = z
  .object({
    version: z.literal(2),
    enabled: z.boolean(),
    trainingModel: ModelChoiceSchema.optional(),
    sourceIds: z.array(TwinSourceIdSchema).max(12),
    candidates: z.array(TwinCandidateSchema).max(100),
    entries: z.array(TwinEntrySchema).max(200),
    processed: z.array(z.string().max(64)).max(50000),
    training,
  })
  .strict();
export type TwinState = z.infer<typeof StateSchema>;
export const emptyTwinState = (): TwinState => ({
  version: 2,
  enabled: false,
  sourceIds: [],
  candidates: [],
  entries: [],
  processed: [],
  training: idleTraining(),
});

/** The persona is separate from project memory. Every accepted trait retains its raw evidence. */
export class TwinStateStore {
  readonly #path: string;
  readonly #mutex = new Mutex();
  constructor(cwd: string) {
    this.#path = join(cwd, ".flecten/twin.json");
  }
  async load(): Promise<TwinState> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(this.#path, "r");
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > 4 * 1024 * 1024)
        throw new Error("Twin state exceeds its storage boundary");
      const value: unknown = JSON.parse(await handle.readFile("utf8"));
      const state = StateSchema.parse(value);
      if (
        state.training.state === "reading" ||
        state.training.state === "learning" ||
        state.training.state === "error"
      )
        state.training = {
          ...state.training,
          state: state.training.state === "error" ? "idle" : "cancelled",
          message:
            state.training.state === "error"
              ? ""
              : "Learning was interrupted. Start a new import to continue.",
        };
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyTwinState();
      throw new Error(
        `Twin state is unavailable; the original file was preserved: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await handle?.close();
    }
  }
  save(state: TwinState, signal?: AbortSignal): Promise<void> {
    const parsed = StateSchema.parse(state);
    return this.#mutex.run(() =>
      atomicWrite(this.#path, `${JSON.stringify(parsed)}\n`, 0o600, signal),
    );
  }
}

export function mergeTwinAdditions(
  state: TwinState,
  candidates: readonly TwinCandidate[],
  digests: readonly string[],
  maxEntries: number,
  strictRoom = false,
): {
  entries: TwinState["entries"];
  candidates: TwinCandidate[];
  processed: string[];
  accepted: TwinCandidate[];
} {
  const known = new Set(state.entries.map((entry) => entry.id));
  const additions = candidates.filter((c) => !known.has(c.id) && !!known.add(c.id));
  const room = Math.max(0, maxEntries - state.entries.length);
  if (strictRoom && room === 0 && additions.length > 0)
    throw new Error("Twin profile is full. Remove obsolete traits before learning more.");
  const accepted = additions.slice(0, room);
  const candidateKnown = new Set([...known, ...state.candidates.map((c) => c.id)]);
  const nextCandidates = [
    ...state.candidates,
    ...additions.slice(room).filter((c) => !candidateKnown.has(c.id) && !!candidateKnown.add(c.id)),
  ].slice(0, 100);
  const now = new Date().toISOString();
  return {
    entries: [...state.entries, ...accepted.map((c) => ({ ...c, revision: 1, updatedAt: now }))],
    candidates: nextCandidates,
    // ponytail: retain 50000 message hashes; add a source cursor if long-running imports exceed this bound.
    processed: [...new Set([...state.processed, ...digests])].slice(-50000),
    accepted,
  };
}

export function buildTaughtTwinCandidate(parsed: {
  reaction?: TwinCandidate["reaction"] | undefined;
  strength?: number | undefined;
  voice?: string | undefined;
  summary: string;
  content: string;
  appliesWhen: string;
  path?: string | undefined;
}): TwinCandidate {
  const quote = parsed.content;
  return {
    id: memoryDigest(JSON.stringify(parsed)).slice(0, 40),
    kind: "lesson",
    reaction: parsed.reaction ?? "anger",
    strength: parsed.strength ?? 2,
    voice: parsed.voice ?? parsed.content.slice(0, 600),
    summary: parsed.summary,
    content: parsed.content,
    appliesWhen: parsed.appliesWhen,
    evidence: [
      {
        sourceId: "flecten",
        sessionId: "twin-editor",
        reference: parsed.path ?? "Twin profile editor",
        digest: memoryDigest(quote),
        quote,
      },
    ],
  };
}
