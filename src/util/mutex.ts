import { abortable } from "./abort";

export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const work = this.#tail.then(() => {
      signal?.throwIfAborted();
      return task();
    });
    this.#tail = work.then(
      () => undefined,
      () => undefined,
    );
    return abortable(work, signal);
  }
}
