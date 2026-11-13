import type { Event } from "../core/types";
import { DurableEventLog } from "../store/events/envelope";
import { recordSessionEvent } from "../store/events/index";
import { sessionPaths } from "../store/paths";
import { redactSecrets } from "./provider-secrets";

/**
 * Durable logs of every session: one append-only file per session plus the session index.
 * Secrets of the config are masked before anything reaches the disk.
 */
export class SessionLogs {
  readonly #cwd: string;
  readonly #secrets: () => readonly string[];
  readonly #logs = new Map<string, Promise<DurableEventLog>>();

  constructor(cwd: string, secrets: () => readonly string[]) {
    this.#cwd = cwd;
    this.#secrets = secrets;
  }

  async persist(event: Event): Promise<void> {
    const log = await this.#open(event.sessionId ?? "system");
    const safe = JSON.parse(redactSecrets(JSON.stringify(event), this.#secrets())) as Event;
    await log.append(safe);
    await recordSessionEvent(this.#cwd, safe);
  }

  /** Closes the log of a session, before it is deleted or moved. */
  async close(sessionId: string): Promise<void> {
    const pending = this.#logs.get(sessionId);
    if (!pending) return;
    this.#logs.delete(sessionId);
    await pending.then((log) => log.close()).catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#logs.keys()].map((sessionId) => this.close(sessionId)));
  }

  #open(sessionId: string): Promise<DurableEventLog> {
    const existing = this.#logs.get(sessionId);
    if (existing) return existing;
    const opened = DurableEventLog.open(sessionPaths(this.#cwd, sessionId).events, sessionId);
    opened.catch(() => this.#logs.delete(sessionId));
    this.#logs.set(sessionId, opened);
    return opened;
  }
}
