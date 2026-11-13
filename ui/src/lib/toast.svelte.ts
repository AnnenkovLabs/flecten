import { pushToast, type ToastItem, type ToastTone, toastDuration } from "./toast-stack";

/** Temporary notices pause while being read; task failures also remain in the thread. */
class ToastState {
  items = $state<ToastItem[]>([]);
  #next = 1;
  #paused = false;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(text: string): void {
    this.#push(text, "info");
  }

  /** Errors get six seconds and remain dismissible immediately. */
  error(text: string): void {
    this.#push(text, "error");
  }

  dismiss(id: number): void {
    this.#stop(id);
    this.items = this.items.filter((item) => item.id !== id);
  }

  /** The pointer or focus is on a notice: nothing fades while it is being read. */
  pause(): void {
    this.#paused = true;
    for (const id of [...this.#timers.keys()]) this.#stop(id);
  }

  resume(): void {
    this.#paused = false;
    for (const item of this.items) this.#schedule(item);
  }

  dispose(): void {
    for (const id of [...this.#timers.keys()]) this.#stop(id);
  }

  #push(text: string, tone: ToastTone): void {
    const { items, shown, dropped } = pushToast(this.items, { id: this.#next, text, tone });
    if (shown.id === this.#next) this.#next += 1;
    for (const id of dropped) this.#stop(id);
    this.items = items;
    this.#schedule(shown);
  }

  #schedule(item: ToastItem): void {
    this.#stop(item.id);
    if (this.#paused) return;
    this.#timers.set(
      item.id,
      setTimeout(() => this.dismiss(item.id), toastDuration(item)),
    );
  }

  #stop(id: number): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
  }
}

export const toast = new ToastState();
