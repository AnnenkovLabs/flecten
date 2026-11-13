import { stableTranslationPrefix } from "./document";
import type { LanguageRun } from "./run";

type Channel = "text" | "reasoning";

/** One request in flight; deltas arriving during it coalesce into the next batch. */
export class TranslationStream {
  readonly #controller = new AbortController();
  readonly #signal: AbortSignal;
  #pending = { text: "", reasoning: "" };
  #source = { text: "", reasoning: "" };
  #display = { text: "", reasoning: "" };
  #tail: Promise<void> | undefined;
  #failure: unknown;
  #ending = false;
  constructor(
    readonly language: LanguageRun,
    readonly emit: (kind: Channel, text: string) => void,
  ) {
    this.#signal = AbortSignal.any([language.signal, this.#controller.signal]);
  }

  push(kind: Channel, text: string): void {
    this.#source[kind] += text;
    this.#pending[kind] += text;
    this.#start();
  }

  #start(): void {
    if (this.#tail || this.#failure) return;
    this.#tail = this.#drain()
      .catch((error: unknown) => {
        this.#failure = error;
      })
      .finally(() => {
        this.#tail = undefined;
      });
  }

  async #drain(): Promise<void> {
    for (;;) {
      this.#signal.throwIfAborted();
      const block = (["reasoning", "text"] as const)
        .map((kind) => ({
          kind,
          size: this.#ending
            ? this.#pending[kind].length
            : this.#pending[kind].length >= 160
              ? stableTranslationPrefix(this.#pending[kind])
              : 0,
        }))
        .find((value) => value.size > 0);
      if (!block) return;
      const { kind, size } = block;
      const text = this.#pending[kind].slice(0, size);
      this.#pending[kind] = this.#pending[kind].slice(size);
      const translated = await this.language.output(text, this.#signal);
      this.#signal.throwIfAborted();
      this.#display[kind] += translated;
      this.emit(kind, translated);
    }
  }

  async finish(): Promise<{ text: string; reasoning: string }> {
    this.#ending = true;
    await this.#tail;
    this.#start();
    await this.#tail;
    if (this.#failure) throw this.#failure;
    this.language.remember(this.#source.text, this.#display.text);
    this.language.remember(this.#source.reasoning, this.#display.reasoning);
    return this.#display;
  }

  async cancel(): Promise<void> {
    this.#controller.abort();
    await this.#tail;
  }
}
