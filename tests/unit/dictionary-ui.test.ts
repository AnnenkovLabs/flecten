import { afterEach, expect, test } from "bun:test";
import type { DictionaryRecord, DictionarySnapshot } from "../../shared/dictionary";
import { DictionaryStore } from "../../ui/src/lib/dictionary.svelte";
import type { AgentCommand, AgentEvent } from "../../ui/src/lib/types";

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});
type Request = Extract<AgentCommand, { requestId: string }>;
type Response = Extract<AgentEvent, { type: "response" }>;

function bridge(respond: (command: Request) => Promise<Omit<Response, "requestId" | "type">>) {
  const listeners = new Set<(event: AgentEvent) => void>();
  globalThis.window = {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          if (!("requestId" in command)) throw new Error("expected request");
          void respond(command).then((result) => {
            for (const listener of listeners)
              listener({ type: "response", requestId: command.requestId, ...result });
          });
        },
      },
    },
  } as unknown as Window & typeof globalThis;
}

const publicEntry: DictionaryRecord = {
  id: "vibe-coding",
  term: "Vibe coding",
  category: "development",
  aliases: ["вайбкодинг"],
  definition: "Building products with AI coding agents.",
  sources: [],
  source: "public",
};
const localEntry: DictionaryRecord = {
  ...publicEntry,
  definition: "Our team's meaning.",
  source: "local",
  revision: 3,
};
const snapshot: DictionarySnapshot = {
  publicSource: "https://github.com/AnnenkovLabs/flecten",
  entries: [publicEntry, localEntry],
};

test("dictionary editor keeps local revisions, refuses failed saves and confirms deletion", async () => {
  const requests: Request[] = [];
  let fail = true;
  bridge(async (command) => {
    requests.push(command);
    if (command.type === "dictionary.save" && fail)
      return { ok: false, error: "Revision conflict" };
    if (command.type === "dictionary.forget")
      return { ok: true, dictionary: { ...snapshot, entries: [publicEntry] } };
    return { ok: true, dictionary: snapshot };
  });
  const dictionary = new DictionaryStore();
  await dictionary.load();
  dictionary.edit(publicEntry);
  expect(dictionary.draft?.definition).toBe(localEntry.definition);
  expect(dictionary.draft?.expectedRevision).toBe(3);
  if (!dictionary.draft) throw new Error("draft missing");
  dictionary.draft.definition = "Revised meaning";
  dictionary.draft.aliases = "vibe-coding\n\nвайбкодинг";
  await dictionary.save();
  expect(dictionary.error).toBe("Revision conflict");
  expect(dictionary.draft?.definition).toBe("Revised meaning");
  const save = requests.find((command) => command.type === "dictionary.save");
  expect(save).toMatchObject({
    expectedRevision: 3,
    entry: { aliases: ["vibe-coding", "вайбкодинг"] },
  });
  fail = false;
  await dictionary.save();
  expect(dictionary.draft).toBeNull();
  expect(dictionary.scope).toBe("local");
  await dictionary.forget();
  expect(requests.some((command) => command.type === "dictionary.forget")).toBe(false);
  dictionary.deleting = localEntry;
  await dictionary.forget();
  expect(dictionary.hasLocal(localEntry.id)).toBe(false);
  expect(dictionary.deleting).toBeNull();
});

test("switching projects discards late dictionary responses and invalid definitions stay unsaved", async () => {
  let release: ((value: Omit<Response, "requestId" | "type">) => void) | undefined;
  const requests: Request[] = [];
  bridge((command) => {
    requests.push(command);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const dictionary = new DictionaryStore();
  const loading = dictionary.load();
  dictionary.reset();
  release?.({ ok: true, dictionary: snapshot });
  await loading;
  expect(dictionary.snapshot).toBeNull();
  dictionary.edit();
  await dictionary.save();
  expect(dictionary.error.length).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);
});
