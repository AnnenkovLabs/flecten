import type { Handler } from "./server-session-handlers";
import type { AppService } from "./service-types";

export const DICTIONARY_COMMANDS = [
  "dictionary.list",
  "dictionary.sync",
  "dictionary.save",
  "dictionary.forget",
] as const;
export type DictionaryCommandType = (typeof DICTIONARY_COMMANDS)[number];

export function dictionaryHandlers(app: AppService): Record<DictionaryCommandType, Handler> {
  return {
    "dictionary.list": async () => ({ dictionary: await app.dictionary.list() }),
    "dictionary.sync": async () => ({ dictionary: await app.dictionary.sync() }),
    "dictionary.save": async (command) => ({
      dictionary: await app.dictionary.save({
        entry: command.entry,
        ...(command.expectedRevision === undefined
          ? {}
          : { expectedRevision: command.expectedRevision }),
      }),
    }),
    "dictionary.forget": async (command) => ({
      dictionary: await app.dictionary.forget({
        id: command.id,
        expectedRevision: command.expectedRevision,
      }),
    }),
  };
}
