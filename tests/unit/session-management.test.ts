import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createAppService } from "../../src/app/service";
import type { Event, RunStopReason } from "../../src/core/types";
import {
  deleteSession,
  forkSession,
  listSessions,
  recordSessionEvent,
  renameSession,
  SESSION_INDEX_VERSION,
  sessionIndexPath,
} from "../../src/store/events/index";
import { readSession } from "../../src/store/events/read";
import { sessionPaths } from "../../src/store/paths";
import { appendEvent } from "../helpers/append-event";

function started(sessionId: string, prompt: string): Event {
  return { type: "session.started", sessionId, provider: "test", model: "test", prompt };
}

function message(sessionId: string, text: string): Event {
  return { type: "message.finished", sessionId, text, reasoning: "", toolCalls: [] };
}

function finished(sessionId: string, stopReason: RunStopReason = "end"): Event {
  return {
    type: "session.finished",
    sessionId,
    result: {
      sessionId,
      pass: stopReason === "done",
      stopReason,
      summary: "done",
      turns: 1,
      usage: { input: 1, output: 1, cached: 0 },
    },
  };
}

async function seed(cwd: string, id: string, events: Event[]): Promise<void> {
  for (const event of events) await appendEvent(sessionPaths(cwd, id).events, event);
}

async function readIndex(
  cwd: string,
): Promise<{ version: number; sessions: Array<{ id: string; title: string }> }> {
  return JSON.parse(await readFile(sessionIndexPath(cwd), "utf8")) as {
    version: number;
    sessions: Array<{ id: string; title: string }>;
  };
}

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "liquid-session-management-"));
}

describe("session management", () => {
  test("builds the index from legacy event logs and repairs corruption", async () => {
    const cwd = await tempProject();
    try {
      await seed(cwd, "s-one", [
        started("s-one", "First prompt"),
        message("s-one", "hi"),
        finished("s-one"),
      ]);

      const first = await listSessions(cwd);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        id: "s-one",
        title: "First prompt",
        project: basename(cwd),
        messageCount: 1,
        lastPrompt: "First prompt",
        stopReason: "end",
      });

      const index = await readIndex(cwd);
      expect(index.version).toBe(SESSION_INDEX_VERSION);
      expect(index.sessions).toHaveLength(1);

      await seed(cwd, "s-legacy", [started("s-legacy", "Legacy prompt"), finished("s-legacy")]);
      const withLegacy = await listSessions(cwd);
      expect(withLegacy.map((session) => session.id).sort()).toEqual(["s-legacy", "s-one"]);
      expect((await readIndex(cwd)).sessions).toHaveLength(2);

      await writeFile(sessionIndexPath(cwd), "{broken", "utf8");
      const repaired = await listSessions(cwd);
      expect(repaired.map((session) => session.id).sort()).toEqual(["s-legacy", "s-one"]);
      expect((await readIndex(cwd)).sessions).toHaveLength(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("records started, finished and renamed sessions in the index", async () => {
    const cwd = await tempProject();
    try {
      await recordSessionEvent(cwd, started("s-live", "Start prompt"));
      await recordSessionEvent(cwd, message("s-live", "answer"));
      await recordSessionEvent(cwd, finished("s-live", "done"));

      let [session] = await listSessions(cwd);
      expect(session).toMatchObject({
        title: "Start prompt",
        messageCount: 1,
        tokens: 2,
        lastPrompt: "Start prompt",
        stopReason: "done",
      });

      const renamed = await renameSession(cwd, "s-live", "Custom title");
      expect(renamed.title).toBe("Custom title");

      await recordSessionEvent(cwd, started("s-live", "Continue prompt"));
      [session] = await listSessions(cwd);
      expect(session).toMatchObject({ title: "Custom title", lastPrompt: "Continue prompt" });

      await expect(renameSession(cwd, "s-live", "   ")).rejects.toThrow("title is required");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("moves deleted sessions to trash", async () => {
    const cwd = await tempProject();
    try {
      const paths = sessionPaths(cwd, "s-gone");
      await seed(cwd, "s-gone", [started("s-gone", "Delete me"), finished("s-gone")]);
      await mkdir(paths.logs, { recursive: true });
      await writeFile(join(paths.logs, "run.log"), "log body", "utf8");
      await listSessions(cwd);

      const result = await deleteSession(cwd, "s-gone");
      expect(result.trash).toBe(join(cwd, ".liquid", "trash", "s-gone"));
      expect(await stat(paths.session).catch(() => undefined)).toBeUndefined();
      expect(await Bun.file(join(result.trash, "events.jsonl")).exists()).toBe(true);
      expect(await Bun.file(join(result.trash, "logs", "run.log")).text()).toBe("log body");
      expect(await listSessions(cwd)).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("forks messages up to a turn and rewrites session ids", async () => {
    const cwd = await tempProject();
    try {
      const paths = sessionPaths(cwd, "s-one");
      await seed(cwd, "s-one", [
        started("s-one", "First prompt"),
        { type: "turn.started", sessionId: "s-one", turn: 1 },
        message("s-one", "one"),
        { type: "turn.finished", sessionId: "s-one", turn: 1, reason: "end" },
        { type: "turn.started", sessionId: "s-one", turn: 2 },
        message("s-one", "two"),
        { type: "turn.finished", sessionId: "s-one", turn: 2, reason: "end" },
        finished("s-one"),
      ]);
      await mkdir(paths.logs, { recursive: true });
      await writeFile(join(paths.logs, "tool.log"), "copied", "utf8");
      await listSessions(cwd);

      const fork = await forkSession(cwd, "s-one", { turn: 1 });
      expect(fork.id).not.toBe("s-one");
      const events = await readSession(cwd, fork.id);
      expect(events.every((event) => "sessionId" in event && event.sessionId === fork.id)).toBe(
        true,
      );
      expect(
        events.filter((event) => event.type === "message.finished").map((event) => event.text),
      ).toEqual(["one"]);
      const last = events.at(-1);
      expect(last?.type).toBe("session.finished");
      expect(last?.type === "session.finished" ? last.result.sessionId : "").toBe(fork.id);
      expect(await Bun.file(join(sessionPaths(cwd, fork.id).logs, "tool.log")).text()).toBe(
        "copied",
      );

      const source = await readSession(cwd, "s-one");
      expect(source.filter((event) => event.type === "message.finished")).toHaveLength(2);
      expect(source.every((event) => !("sessionId" in event) || event.sessionId === "s-one")).toBe(
        true,
      );

      const [indexed] = await listSessions(cwd, { query: fork.id });
      expect(indexed).toMatchObject({
        title: "First prompt (fork)",
        messageCount: 1,
        lastPrompt: "First prompt",
        stopReason: "end",
      });

      const bySequence = await forkSession(cwd, "s-one", { sequence: 3 });
      const sequenceEvents = await readSession(cwd, bySequence.id);
      expect(
        sequenceEvents
          .filter((event) => event.type === "message.finished")
          .map((event) => event.text),
      ).toEqual(["one"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("searches and paginates from the index without event files", async () => {
    const cwd = await tempProject();
    try {
      await mkdir(join(cwd, ".liquid", "sessions"), { recursive: true });
      const sessions = ["s-a", "s-b", "s-c", "s-d"].map((id, index) => ({
        id,
        title: `Alpha ${index}`,
        project: "project",
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        messageCount: index,
        lastPrompt: index % 2 === 1 ? `needle ${index}` : "other",
      }));
      await writeFile(
        sessionIndexPath(cwd),
        JSON.stringify({ version: SESSION_INDEX_VERSION, sessions }),
        "utf8",
      );

      const page = await listSessions(cwd, { query: "alpha", limit: 2, offset: 1 });
      expect(page.map((session) => session.id)).toEqual(["s-c", "s-b"]);

      const prompts = await listSessions(cwd, { query: "needle" });
      expect(prompts.map((session) => session.id)).toEqual(["s-d", "s-b"]);

      expect((await listSessions(cwd)).map((session) => session.id)).toEqual([
        "s-d",
        "s-c",
        "s-b",
        "s-a",
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("rejects path traversal in session ids", async () => {
    const cwd = await tempProject();
    try {
      for (const id of ["../escape", "a/b", "", ".", ".."]) {
        await expect(readSession(cwd, id)).rejects.toThrow("invalid session id");
        await expect(renameSession(cwd, id, "x")).rejects.toThrow("invalid session id");
        await expect(deleteSession(cwd, id)).rejects.toThrow("invalid session id");
        await expect(forkSession(cwd, id)).rejects.toThrow("invalid session id");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("service exposes rename, confirmed delete and fork", async () => {
    const cwd = await tempProject();
    const service = await createAppService(cwd);
    try {
      await seed(cwd, "s-one", [
        started("s-one", "First prompt"),
        { type: "turn.started", sessionId: "s-one", turn: 1 },
        message("s-one", "one"),
        { type: "turn.finished", sessionId: "s-one", turn: 1, reason: "end" },
        finished("s-one"),
      ]);

      const renamed = await service.renameSession("s-one", "Service title");
      expect(renamed.title).toBe("Service title");
      await expect(service.deleteSession("s-one", {})).rejects.toThrow("confirm: true");

      const forked = await service.forkSession("s-one", { turn: 1 });
      expect(forked.title).toBe("Service title (fork)");

      const result = await service.deleteSession("s-one", { confirm: true });
      expect(await Bun.file(join(result.trash, "events.jsonl")).exists()).toBe(true);
      expect((await service.listSessions()).map((session) => session.id)).toEqual([forked.id]);
      expect((await service.searchSessions("service")).map((session) => session.id)).toEqual([
        forked.id,
      ]);
    } finally {
      await service.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
