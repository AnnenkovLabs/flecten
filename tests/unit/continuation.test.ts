import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { isUserMessage, projectBranches } from "../../src/store/events/branches";
import { listSessions, recordSessionEvent } from "../../src/store/events/index";
import { replayMessages } from "../../src/store/events/replay";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

describe("silent continuation runs", () => {
  test("session emits continuation on session.started and marks the replayed prompt synthetic without memorySource", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-continuation-session-"));
    const events: Event[] = [];
    const session = createSession({
      cwd,
      providerId: "test",
      model: "test-model",
      provider: scriptedProvider([
        [
          { type: "text", delta: "First reply" },
          { type: "done", reason: "end" },
        ],
        [
          { type: "text", delta: "Continued reply" },
          { type: "done", reason: "end" },
        ],
      ]),
      tools: new ToolRegistry([], { limits }),
      system: "System",
      limits,
      maxOutputTokens: 4_000,
      logDir: (id) => join(cwd, ".flecten", "sessions", id, "logs"),
      context: { window: 100_000, reserve: 4_000 },
      loop: { maxTurns: 0, continuations: 0, parallelTools: false },
      onEvent: async (event) => {
        events.push(event);
      },
    });
    try {
      const first = (await session.send({
        type: "run",
        sessionId: "s_cont",
        prompt: "Analyze README.md",
      })) as RunResult;
      expect(first.stopReason).toBe("end");

      const second = (await session.send({
        type: "run",
        sessionId: "s_cont",
        prompt: "/continue",
        continuation: true,
      })) as RunResult;
      expect(second.stopReason).toBe("end");

      const starts = events.filter(
        (event): event is Extract<Event, { type: "session.started" }> =>
          event.type === "session.started",
      );
      expect(starts).toHaveLength(2);
      const [initial, continued] = starts;
      expect(initial?.continuation).toBeUndefined();
      expect(continued?.continuation).toBe(true);
      if (!initial || !continued) throw new Error("Expected two session.started events");

      expect(isUserMessage(initial)).toBe(true);
      expect(isUserMessage(continued)).toBe(false);
      const projected = projectBranches(events.map((event, i) => ({ seq: i + 1, event })));
      expect(projected.visibleMessages).toHaveLength(1);
      expect(projected.messageVersions).toHaveLength(1);

      const replayed = replayMessages(events.map((event, i) => ({ seq: i + 1, event })));
      const users = replayed.messages.filter((message) => message.role === "user");
      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        content: "Analyze README.md",
        memorySource: "Analyze README.md",
      });
      expect(users[1]).toMatchObject({ content: "/continue", synthetic: true });
      expect(users[1]?.memorySource).toBeUndefined();

      const liveUsers = session.getHistory().filter((message) => message.role === "user");
      expect(liveUsers[1]).toMatchObject({ synthetic: true });
      expect(liveUsers[1]?.memorySource).toBeUndefined();
    } finally {
      await session.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("session index keeps the user's real lastPrompt instead of /continue", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-continuation-index-"));
    try {
      await recordSessionEvent(cwd, {
        type: "session.started",
        sessionId: "s_idx",
        provider: "test",
        model: "test-model",
        prompt: "Build the sidebar",
      });
      await recordSessionEvent(cwd, {
        type: "session.started",
        sessionId: "s_idx",
        provider: "test",
        model: "test-model",
        prompt: "/continue",
        continuation: true,
      });
      const sessions = await listSessions(cwd);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.title).toBe("Build the sidebar");
      expect(sessions[0]?.lastPrompt).toBe("Build the sidebar");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
