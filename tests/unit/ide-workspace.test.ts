import { afterEach, expect, test } from "bun:test";
import type { TwinSnapshot } from "../../shared/twin";
import type { IdeWorkspace as Workspace } from "../../ui/src/lib/ide.svelte";
import type { AgentCommand, AgentEvent, AgentFilePreview } from "../../ui/src/lib/types";
import "../helpers/svelte-runes";

const { IdeWorkspace } = (await import("../../ui/src/lib/ide.svelte")) as {
  IdeWorkspace: new () => Workspace;
};

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});

type Request = Extract<AgentCommand, { requestId: string }>;
type Response = Extract<AgentEvent, { type: "response" }>;

function bridge(
  respond: (command: Request) => Promise<Omit<Response, "requestId" | "type">>,
): void {
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
            for (const listener of listeners) {
              listener({ type: "response", requestId: command.requestId, ...result });
            }
          });
        },
      },
    },
  } as unknown as Window & typeof globalThis;
}

function file(text: string): AgentFilePreview {
  return { path: "src/a.ts", text, size: text.length, hash: text, truncated: false, binary: false };
}

test("IDE keeps drafts through refresh, conflicts and dirty-close cancellation", async () => {
  let disk = "initial";
  bridge(async (command) => {
    if (command.type === "files.list") return { ok: true, files: ["src/a.ts"] };
    if (command.type === "files.write") {
      if (command.expectedHash !== disk) return { ok: false, error: "Файл изменился на диске" };
      disk = command.text;
    }
    return { ok: true, file: file(disk) };
  });
  const ide = new IdeWorkspace();
  await ide.open("src/a.ts");
  ide.update("src/a.ts", "my draft");
  disk = "agent edit";
  await ide.requestRefresh();
  expect(ide.active?.text).toBe("my draft");
  expect(ide.active?.changedOnDisk).toBe(true);
  expect(await ide.save()).toBe(false);
  expect(ide.active?.text).toBe("my draft");
  expect(ide.active?.error).toContain("Файл изменился на диске");
  ide.close("src/a.ts");
  expect(ide.pending).toEqual({ path: "src/a.ts", action: "close" });
  await ide.resolvePending("cancel");
  expect(ide.tabs).toHaveLength(1);
  await ide.reload();
  await ide.resolvePending("discard");
  expect(ide.active?.text).toBe("agent edit");
  ide.update("src/a.ts", "saved edit");
  expect(await ide.save()).toBe(true);
  expect(disk).toBe("saved edit");
  expect(ide.dirty).toBe(false);
});

test("IDE ignores reads from an old project and preserves edits made during a save", async () => {
  let releaseRead: ((file: AgentFilePreview) => void) | undefined;
  bridge(async () => ({
    ok: true,
    file: await new Promise<AgentFilePreview>((resolve) => {
      releaseRead = resolve;
    }),
  }));
  const ide = new IdeWorkspace();
  const opening = ide.open("src/a.ts");
  ide.reset();
  releaseRead?.(file("old project"));
  await opening;
  expect(ide.tabs).toHaveLength(0);
  let releaseSave: (() => void) | undefined;
  bridge(async (command) => {
    if (command.type === "files.write") {
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return { ok: true, file: file(command.text) };
    }
    return { ok: true, file: file("initial") };
  });
  await ide.open("src/a.ts");
  ide.update("src/a.ts", "first edit");
  const saving = ide.save();
  ide.update("src/a.ts", "next edit");
  releaseSave?.();
  await saving;
  expect(ide.active?.text).toBe("next edit");
  expect(ide.active?.savedText).toBe("first edit");
  expect(ide.dirty).toBe(true);
});

test("a saved edit teaches Twin only after an explicit rule and preserves the pending lesson on failure", async () => {
  let disk = "console.log('order')";
  let rejectLesson = true;
  const sent: Request[] = [];
  const twin: TwinSnapshot = {
    enabled: true,
    sources: [],
    candidates: [],
    entries: [],
    training: {
      state: "idle",
      message: "",
      sessions: 0,
      messages: 0,
      usage: { input: 0, output: 0, cached: 0 },
      provider: "test",
      model: "model",
    },
    limits: {
      maxSessions: 100,
      maxMessages: 160,
      maxInputCharacters: 64000,
      maxCandidates: 12,
      maxProfileEntries: 64,
    },
  };
  bridge(async (command) => {
    sent.push(command);
    if (command.type === "files.write") disk = command.text;
    if (command.type === "twin.teach")
      return rejectLesson ? { ok: false, error: "Try again" } : { ok: true, twin };
    return { ok: true, file: file(disk) };
  });
  const ide = new IdeWorkspace();
  await ide.open("src/a.ts");
  ide.update("src/a.ts", "logger.info('order')");
  expect(await ide.save()).toBe(true);
  expect(sent.map((command) => command.type)).toEqual(["files.read", "files.write"]);
  expect(ide.correction.pending).toMatchObject({
    path: "src/a.ts",
    before: "console.log('order')",
    after: "logger.info('order')",
  });
  const id = ide.correction.pending?.id ?? -1;
  expect(await ide.correction.teach(id, "", "when logging")).toBe(false);
  expect(sent).toHaveLength(2);
  expect(await ide.correction.teach(id, "Use logger.info.", "when logging")).toBe(false);
  expect(ide.correction.error).toBe("Try again");
  expect(ide.correction.pending?.id).toBe(id);
  rejectLesson = false;
  expect(await ide.correction.teach(id, "Use logger.info.", "when logging")).toBe(true);
  expect(sent.at(-1)).toMatchObject({
    type: "twin.teach",
    path: "src/a.ts",
    content: "Use logger.info.",
    appliesWhen: "when logging",
    before: "console.log('order')",
    after: "logger.info('order')",
  });
  expect(ide.correction.pending).toBeNull();
  expect(ide.correction.taughtPath).toBe("src/a.ts");
  ide.reset();
  expect(ide.correction.taughtPath).toBe("");
});
