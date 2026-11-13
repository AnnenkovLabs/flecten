import { join } from "node:path";
import type { HarnessConfig } from "../config/schema";
import { CheckpointStore, ShellCheckpointService, WorkspaceSnapshots } from "../store/checkpoints";
import type { ShellCheckpointState } from "./service-types";
import { checkpointSettings } from "./session-config";

const DAY_MS = 86_400_000;

/**
 * Snapshots around bash and terminal commands live in a shadow git under .liquid/shadow,
 * separate from the user's repository: the user's git keeps what the user decides to
 * commit, the shadow keeps every command of the agent. Warming runs in the background.
 */
export function shellCheckpointsFor(
  cwd: string,
  config: HarnessConfig,
  store: CheckpointStore,
): ShellCheckpointService | undefined {
  const settings = checkpointSettings(config);
  if (!settings.shell) return undefined;
  const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".liquid", "shadow"));
  void snapshots.warm().catch(() => undefined);
  return new ShellCheckpointService(snapshots, store, {
    maxFiles: settings.maxFiles,
    maxBytes: settings.maxMegabytes * 1024 * 1024,
  });
}

/** Shell snapshots of the app and their state for the UI: ready, indexing, off or broken. */
export class ShellSnapshots {
  readonly #cwd: string;
  readonly #store: CheckpointStore;
  #key = "";
  #service: ShellCheckpointService | undefined;
  #state: ShellCheckpointState = { state: "off" };

  constructor(cwd: string, store: CheckpointStore) {
    this.#cwd = cwd;
    this.#store = store;
  }

  get service(): ShellCheckpointService | undefined {
    return this.#service;
  }

  get state(): ShellCheckpointState {
    return this.#state;
  }

  /** Rebuilds snapshots only when their settings change: warming a big tree costs time. */
  configure(config: HarnessConfig): void {
    const key = JSON.stringify(checkpointSettings(config));
    if (key === this.#key) return;
    this.#key = key;
    const current = shellCheckpointsFor(this.#cwd, config, this.#store);
    this.#service = current;
    if (!current) {
      this.#state = { state: "off", reason: "выключены в настройках (checkpoints.shell)" };
      return;
    }
    this.#state = { state: "indexing", reason: "первичная индексация рабочей папки ещё идёт" };
    void current.ready().then(
      (reason) => {
        if (this.#service !== current) return;
        this.#state = reason ? { state: "unavailable", reason } : { state: "ready" };
      },
      (error: unknown) => {
        if (this.#service === current)
          this.#state = { state: "unavailable", reason: String(error) };
      },
    );
  }
}

/** Drops checkpoints beyond `keep` and older than `maxAgeDays`, with their unreferenced objects. */
export async function pruneCheckpoints(store: CheckpointStore, config: HarnessConfig) {
  const settings = checkpointSettings(config);
  return store.prune({ keep: settings.keep, maxAgeMs: settings.maxAgeDays * DAY_MS });
}

export { CheckpointStore };
