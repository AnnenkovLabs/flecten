import { type FileHandle, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  TwinCandidateSchema,
  TwinEntrySchema,
  type TwinSnapshot,
  TwinSourceIdSchema,
} from "../../shared/twin";
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
  usage: z.object({
    input: z.number().min(0),
    output: z.number().min(0),
    cached: z.number().min(0),
    costUsd: z.number().min(0).optional(),
  }),
  provider: z.string(),
  model: z.string(),
});
const StateSchema = z
  .object({
    version: z.literal(2),
    enabled: z.boolean(),
    sourceIds: z.array(TwinSourceIdSchema).max(9),
    candidates: z.array(TwinCandidateSchema).max(100),
    entries: z.array(TwinEntrySchema).max(64),
    processed: z.array(z.string().max(64)).max(5000),
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
    this.#path = join(cwd, ".liquid/twin.json");
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
      if (state.training.state === "reading" || state.training.state === "learning")
        state.training = {
          ...state.training,
          state: "cancelled",
          message: "Learning was interrupted. Start a new import to continue.",
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
