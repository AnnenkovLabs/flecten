import workerPrompt from "../../prompts/translation-worker.md" with { type: "text" };
import type { PromptTextPart } from "../context/prompt-budget";
import { parseCompletionSignal } from "../core/goal/completion";
import type { UsagePrice } from "../core/session/budget";
import type { Message } from "../core/types";
import { HarnessError } from "../errors";
import type { TranslationClient, TranslationUsage } from "./client";

export interface LanguageOptions {
  client: TranslationClient;
  language: string;
  price: UsagePrice;
  providerId: string;
}

/** One run owns its display language; simultaneous sessions never change each other's target. */
export class LanguageRun {
  language = "en";
  readonly #outputs = new Map<string, string>();
  #outputFailed = false;
  constructor(
    readonly options: LanguageOptions,
    readonly signal: AbortSignal,
    readonly onUsage: (usage: TranslationUsage) => void,
    readonly onFailure: () => void = () => {},
  ) {}

  async prepare(prompt: string, input: string, history: Message[], resumed = false) {
    const translated = await this.inputResult(prompt);
    const previous = history.findLast((message) => message.role === "user");
    for (const message of history) {
      if (message.role === "tool" || message.workingLanguage === "en") continue;
      const value = await this.inputResult(message.content);
      if (message.role === "assistant" && message.reasoning) {
        message.reasoning = await this.input(message.reasoning);
      }
      message.content = value.text;
      message.workingLanguage = "en";
      if (message.role === "user") message.sourceLanguage ??= value.language;
    }
    this.language =
      this.options.language === "auto"
        ? (resumed || translated.language === "und") &&
          previous?.role === "user" &&
          previous.sourceLanguage &&
          previous.sourceLanguage !== "und"
          ? previous.sourceLanguage
          : translated.language === "und"
            ? "en"
            : translated.language
        : new Intl.Locale(this.options.language).toString();
    return input === prompt ? translated.text : await this.input(input);
  }

  async system(system: string, parts?: readonly PromptTextPart[]): Promise<string> {
    const blocks = parts ?? [{ text: system }];
    if (blocks.map((part) => part.text).join("\n\n") !== system)
      throw new HarnessError(
        "provider_failed",
        "System prompt parts do not match the assembled text",
      );
    const translated: string[] = [];
    for (const part of blocks)
      translated.push(
        part.workingLanguage === "en"
          ? part.text
          : (await this.inputResult(part.text, "системные инструкции")).text,
      );
    return `${translated.join("\n\n")}\n\n${workerPrompt.trim()}`;
  }

  async input(text: string): Promise<string> {
    return (await this.inputResult(text)).text;
  }

  async inputResult(text: string, subject = "запрос") {
    return this.options.client
      .translate(text, "en", this.signal, this.onUsage)
      .catch((error: unknown) => {
        this.signal.throwIfAborted();
        const reason =
          error instanceof HarnessError
            ? error.message
            : "Модель вернула неполный или некорректный перевод.";
        throw new HarnessError(
          "provider_failed",
          `Не удалось перевести ${subject} (${this.options.providerId} / ${this.options.client.provider.model}). ${reason}`,
          { cause: error },
        );
      });
  }

  async output(text: string, signal = this.signal): Promise<string> {
    if (!text.trim() || this.#outputFailed || new Intl.Locale(this.language).language === "en")
      return text;
    const cached = this.#outputs.get(text);
    if (cached !== undefined) return cached;
    const result = await this.options.client
      .translate(text, this.language, signal, this.onUsage)
      .catch((error: unknown) => {
        if (!signal.aborted && !this.#outputFailed) {
          this.#outputFailed = true;
          this.onFailure();
        }
        throw error;
      });
    this.remember(text, result.text);
    return result.text;
  }

  async display(text: string): Promise<string> {
    try {
      return await this.output(text);
    } catch {
      this.signal.throwIfAborted();
      return text;
    }
  }

  remember(text: string, display: string): void {
    if (this.#outputs.size >= 128) this.#outputs.clear();
    this.#outputs.set(text, display);
    const original = parseCompletionSignal(text);
    const localized = parseCompletionSignal(display);
    if (original.complete && localized.complete) {
      this.#outputs.set(original.summary, localized.summary);
      this.#outputs.set(original.text, localized.text);
    }
  }
}
