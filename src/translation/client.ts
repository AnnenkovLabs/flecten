import { z } from "zod";
import prompt from "../../prompts/translation.md" with { type: "text" };
import type { Usage } from "../core/types";
import { addUsage } from "../core/types/message";
import { HarnessError } from "../errors";
import type { ModelProvider } from "../providers/types";
import { markdownData } from "../util/markdown";
import { translationDocument } from "./document";

const ResultSchema = z
  .object({
    sourceLanguage: z.string().min(2).max(35),
    allEnglish: z.boolean(),
    texts: z.array(z.string()),
  })
  .strict();
const TOOL = "translation_result";
export interface TranslationUsage {
  usage: Usage;
  durationMs: number;
}

export class TranslationClient {
  // ponytail: bounded process-local cache; use a private persistent cache if repeated app restarts dominate cost.
  readonly #cache = new Map<string, { text: string; language: string }>();
  constructor(
    readonly provider: ModelProvider,
    readonly timeoutMs: number,
    readonly maxOutputTokens = 16384,
  ) {}

  async translate(
    text: string,
    target: string,
    signal: AbortSignal,
    onUsage: (value: TranslationUsage) => void,
  ): Promise<{ text: string; language: string }> {
    signal.throwIfAborted();
    if (text.length > 1_000_000)
      throw new Error("Translation input exceeds one million characters");
    if (!text.trim()) return { text, language: "und" };
    const key = JSON.stringify([target, text]);
    const cached = this.#cache.get(key);
    if (cached) return cached;
    const document = translationDocument(text);
    if (!document.texts.length) return { text, language: "und" };
    const translated: string[] = [];
    let language = "und";
    let allEnglish = true;
    for (let index = 0; index < document.texts.length; ) {
      const batch: string[] = [];
      let size = 0;
      while (index < document.texts.length) {
        const segment = document.texts[index];
        if (segment === undefined) break;
        if (size && size + segment.length > 6000) break;
        batch.push(segment);
        size += segment.length;
        index++;
      }
      const response = await this.#request(batch, target, signal, onUsage);
      translated.push(...(target === "en" && response.allEnglish ? batch : response.texts));
      allEnglish &&= response.allEnglish;
      if (language === "und")
        language =
          response.sourceLanguage === "und"
            ? "und"
            : new Intl.Locale(response.sourceLanguage).language;
    }
    const result = {
      language,
      text: target === "en" && allEnglish ? text : document.restore(translated),
    };
    if (this.#cache.size >= 256) this.#cache.delete(this.#cache.keys().next().value ?? "");
    if (text.length <= 32_000) this.#cache.set(key, result);
    return result;
  }

  async #request(
    texts: string[],
    target: string,
    signal: AbortSignal,
    onUsage: (value: TranslationUsage) => void,
  ) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const started = performance.now();
    let response: z.infer<typeof ResultSchema> | undefined;
    let complete = false;
    let usage: Usage = { input: 0, output: 0, cached: 0 };
    try {
      for await (const event of this.provider.stream(
        {
          model: this.provider.model,
          system: prompt,
          messages: [
            {
              role: "user",
              content: [
                `# Target language\n\n${target}`,
                ...texts.map((value, index) => markdownData(`Segment ${index + 1}`, [], value)),
              ].join("\n\n"),
            },
          ],
          tools: [
            {
              name: TOOL,
              description: "Return the faithful translations in source order.",
              parameters: z.toJSONSchema(ResultSchema),
            },
          ],
          toolChoice: "required",
          maxTokens: Math.min(this.maxOutputTokens, Math.max(1024, texts.join("").length * 2)),
          reasoning: "none",
        },
        combined,
      )) {
        combined.throwIfAborted();
        if (event.type === "tool_call") {
          if (event.name !== TOOL || response) throw new Error("Unexpected translation tool call");
          response = ResultSchema.parse(event.args);
        } else if (event.type === "usage") {
          usage = addUsage(usage, event);
        } else if (event.type === "done") complete = event.reason !== "max_tokens";
      }
    } catch (error) {
      if (combined.aborted && !signal.aborted) {
        throw new HarnessError(
          "provider_failed",
          `Переводчик не завершил ответ за ${this.timeoutMs / 1000} с. Увеличьте время ожидания перевода или выберите более быструю модель.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      onUsage({ usage, durationMs: performance.now() - started });
    }
    combined.throwIfAborted();
    if (!complete || !response) throw new Error("Translation was incomplete");
    const language =
      response.sourceLanguage === "und" ? "und" : new Intl.Locale(response.sourceLanguage).language;
    if (target === "en" && response.allEnglish) {
      if (language !== "en") throw new Error("Contradictory English language detection");
      return { ...response, texts };
    }
    if (response.texts.length !== texts.length)
      throw new Error("Translation segment count mismatch");
    if (response.texts.some((value, index) => !value.trim() && texts[index]?.trim()))
      throw new Error("Translation omitted a nonempty segment");
    return response;
  }
}
