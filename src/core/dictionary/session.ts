import { sessionMemoryAllowed } from "../session/memory";
import type { SessionOptions } from "../session/options";
import { DictionaryRuntime } from "./runtime";

export function sessionDictionary(options: SessionOptions, prompt: string, sessionId: string) {
  const port = options.dictionary;
  if (!port) return undefined;
  return new DictionaryRuntime(
    {
      list: async () =>
        (await sessionMemoryAllowed(options, sessionId, "read")) ? port.list() : [],
    },
    prompt,
    options.secrets?.(),
  );
}
