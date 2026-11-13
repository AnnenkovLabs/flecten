import { translatedPromptStamp } from "../../translation/prompt";
import { LanguageRun } from "../../translation/run";
import type { Event, Message } from "../types";
import { addUsage } from "../types/message";
import { BUDGET_ABORT } from "./budget";
import type { SessionOptions } from "./options";
import type { ActiveRun } from "./runtime";

export function runLanguage(
  options: SessionOptions,
  state: ActiveRun,
  emit: (event: Event) => void,
): LanguageRun | undefined {
  const selected = options.language;
  if (!selected) return undefined;
  return new LanguageRun(
    selected,
    state.controller.signal,
    ({ usage, durationMs }) => {
      state.usage = addUsage(state.usage, usage);
      emit({
        type: "usage",
        sessionId: state.sessionId,
        usage,
        purpose: "translation",
        provider: selected.providerId,
        model: selected.client.provider.model,
        durationMs,
      });
      emit({
        type: "budget",
        sessionId: state.sessionId,
        budget: state.budget.add(usage, selected.price),
      });
      if (state.budget.exhausted()) state.controller.abort(BUDGET_ABORT);
    },
    () =>
      emit({
        type: "translation.failed",
        sessionId: state.sessionId,
        message:
          "Не удалось перевести ответ. Показан английский оригинал; проверьте модель перевода в настройках.",
      }),
  );
}

export async function translatedRunInput(
  language: LanguageRun | undefined,
  prompt: string,
  input: string,
  history: Message[],
  options: SessionOptions,
  sessionId: string,
  emit: (event: Event) => void,
  resumed?: boolean,
) {
  if (!language) return { modelInput: input, system: options.system };
  const modelInput = await language.prepare(prompt, input, history, resumed);
  const system = await language.system(options.system, options.systemParts);
  emit({
    type: "input.translated",
    sessionId,
    input: modelInput,
    language: language.language,
    ...(options.promptStamp
      ? { system: translatedPromptStamp(system, options.promptStamp, options.tools.specs()) }
      : {}),
  });
  return { modelInput, system };
}
