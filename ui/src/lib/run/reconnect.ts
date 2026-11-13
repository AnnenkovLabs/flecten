/** Pauses before each restart of a stopped core, in ms. */
const DELAYS = [1000, 2000, 4000, 8000, 15_000];

/**
 * Restarts a core that stopped: the shell starts a new process on the next command, so a
 * restart is a `hello` after a pause that grows with every failure in a row.
 */
export class Reconnect {
  #attempt = 0;
  #pending = false;
  #held = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** True while a restart is on its way; the next status is the restarted core. */
  get pending(): boolean {
    return this.#pending;
  }

  /** True after the core said another window holds the project: no restart on a timer. */
  get held(): boolean {
    return this.#held;
  }

  /** Stops restarts until a core answers; the next command starts one by itself. */
  hold(): void {
    this.#held = true;
    this.#pending = false;
    clearTimeout(this.#timer);
  }

  /** Schedules a restart; returns false when every attempt is spent. */
  schedule(restart: () => void): boolean {
    const delay = DELAYS[this.#attempt];
    if (delay === undefined) {
      this.#pending = false;
      return false;
    }
    this.#attempt += 1;
    this.#pending = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(restart, delay);
    return true;
  }

  /** The core answered: returns whether this was a restart. */
  ready(): boolean {
    const restarted = this.#pending;
    this.#pending = false;
    this.#held = false;
    this.#attempt = 0;
    return restarted;
  }

  dispose(): void {
    clearTimeout(this.#timer);
  }
}
