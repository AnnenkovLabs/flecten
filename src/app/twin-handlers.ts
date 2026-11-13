import type { Handler } from "./server-session-handlers";
import type { AppService } from "./service-types";

export const TWIN_COMMANDS = [
  "twin.get",
  "twin.scan",
  "twin.train",
  "twin.cancel",
  "twin.configure",
  "twin.review",
  "twin.update",
  "twin.forget",
  "twin.teach",
  "twin.consult",
] as const;
export type TwinCommandType = (typeof TWIN_COMMANDS)[number];

export function twinHandlers(app: AppService): Record<TwinCommandType, Handler> {
  return {
    "twin.get": async () => ({ twin: await app.twin.get() }),
    "twin.scan": async () => ({ twin: await app.twin.scan() }),
    "twin.train": async (command) => ({ twin: await app.twin.train(command) }),
    "twin.cancel": async () => ({ twin: await app.twin.cancel() }),
    "twin.configure": async (command) => ({ twin: await app.twin.configure(command) }),
    "twin.update": async (command) => ({ twin: await app.twin.update(command) }),
    "twin.review": async (command) => ({ twin: await app.twin.review(command) }),
    "twin.forget": async (command) => ({ twin: await app.twin.forget(command) }),
    "twin.teach": async (command) => ({ twin: await app.twin.teach(command) }),
    "twin.consult": async (command) => ({
      twin: await app.twin.get(),
      answer: await app.twin.consult(command),
    }),
  };
}
