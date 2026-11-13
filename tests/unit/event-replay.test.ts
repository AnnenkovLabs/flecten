import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event, ToolCall } from "../../src/core/types";
import {
  DurableEventLog,
  readTolerant,
  SCHEMA_VERSION,
  validateEnvelope,
  withEnvelope,
} from "../../src/store/events/envelope";
import { replayMessages } from "../../src/store/events/replay";

const TS = "2026-10-25T12:00:00.000Z";

function started(sessionId: string, prompt: string): Event {
  return { type: "session.started", sessionId, provider: "test", model: "test-model", prompt };
}

function assistant(sessionId: string, text: string, toolCalls: ToolCall[] = []): Event {
  return { type: "message.finished", sessionId, text, reasoning: "", toolCalls };
}

function turnStarted(sessionId: string, turn: number): Event {
  return { type: "turn.started", sessionId, turn };
}

function usage(sessionId: string, input: number, output: number, cached: number): Event {
  return { type: "usage", sessionId, usage: { input, output, cached } };
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-event-replay-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("event envelope", () => {
  test("builds and validates envelopes", () => {
    const event = started("s-validate", "hello");
    const envelope = withEnvelope(event, 7, "s-validate", TS);
    expect(envelope).toEqual({
      seq: 7,
      ts: TS,
      schemaVersion: SCHEMA_VERSION,
      sessionId: "s-validate",
      event,
    });
    expect(validateEnvelope(envelope)).toEqual(envelope);
    expect(() => validateEnvelope({ ...envelope, seq: -1 })).toThrow();
    expect(() => validateEnvelope({ ...envelope, ts: "not-a-date" })).toThrow();
    expect(() => validateEnvelope({ ...envelope, event: { type: "unknown" } })).toThrow();
    expect(() => withEnvelope(event, 1, "s-other")).toThrow("does not match");
  });
});

describe("DurableEventLog", () => {
  test("appends envelopes in call order", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-order");
      await log.append(started("s-order", "hello"));
      await log.append(turnStarted("s-order", 1));
      await log.append(usage("s-order", 3, 2, 1));
      await log.flush();
      const { envelopes, corrupt } = await readTolerant(path);
      await log.close();

      expect(corrupt).toEqual([]);
      expect(envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 3]);
      expect(envelopes.map((envelope) => envelope.event.type)).toEqual([
        "session.started",
        "turn.started",
        "usage",
      ]);
      expect(envelopes.map((envelope) => envelope.sessionId)).toEqual([
        "s-order",
        "s-order",
        "s-order",
      ]);
      expect(envelopes.every((envelope) => envelope.schemaVersion === SCHEMA_VERSION)).toBe(true);
      expect(envelopes[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test("serializes concurrent appends", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-concurrent");
      const events = Array.from({ length: 25 }, (_, index) =>
        turnStarted("s-concurrent", index + 1),
      );
      await Promise.all(events.map((event) => log.append(event)));
      await log.close();

      const { envelopes, corrupt } = await readTolerant(path);
      expect(corrupt).toEqual([]);
      expect(envelopes.map((envelope) => envelope.seq)).toEqual(
        Array.from({ length: 25 }, (_, index) => index + 1),
      );
      expect(
        envelopes.map((envelope) =>
          envelope.event.type === "turn.started" ? envelope.event.turn : 0,
        ),
      ).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
      expect(log.lastError).toBeUndefined();
    });
  });

  test("flush waits for queued writes", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-flush");
      const first = log.append(started("s-flush", "one"));
      const second = log.append(turnStarted("s-flush", 1));
      await log.flush();
      const { envelopes } = await readTolerant(path);
      expect(envelopes.map((envelope) => envelope.seq)).toEqual([1, 2]);
      await Promise.all([first, second]);
      await log.close();
    });
  });

  test("reports write errors after close", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-closed");
      await log.close();
      await expect(log.append(started("s-closed", "late"))).rejects.toThrow("closed");
      expect(log.lastError?.message).toContain("closed");
    });
  });
});

describe("readTolerant", () => {
  test("quarantines corrupt lines and keeps the rest", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-corrupt");
      await log.append(started("s-corrupt", "hello"));
      await log.append(assistant("s-corrupt", "first"));
      await log.close();

      await appendFile(path, "this is not json\n");
      await appendFile(
        path,
        `${JSON.stringify({
          seq: 3,
          ts: "yesterday",
          schemaVersion: SCHEMA_VERSION,
          sessionId: "s-corrupt",
          event: { type: "turn.started", sessionId: "s-corrupt", turn: 1 },
        })}\n`,
      );
      await appendFile(
        path,
        `${JSON.stringify(withEnvelope(assistant("s-corrupt", "second"), 5, "s-corrupt", TS))}\n`,
      );

      const { envelopes, corrupt } = await readTolerant(path);
      expect(envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 5]);
      expect(corrupt.map((entry) => entry.line)).toEqual([3, 4]);
      expect(corrupt.every((entry) => entry.error.length > 0)).toBe(true);
    });
  });
});

describe("replayMessages", () => {
  test("recovers interrupted tool batches with one result for every call", () => {
    const read: ToolCall = { id: "read-1", name: "read", args: { path: "a.txt" } };
    const write: ToolCall = {
      id: "write-1",
      name: "write",
      args: { path: "b.txt", content: "data" },
    };
    const events: Event[] = [
      started("s_crash", "go"),
      assistant("s_crash", "", [read, write]),
      {
        type: "tool.finished",
        sessionId: "s_crash",
        call: read,
        result: { ok: true, output: "read output" },
      },
      { type: "run.interrupted", sessionId: "s_crash", at: Date.now(), reason: "crash" },
      started("s_crash", "/continue"),
    ];
    const replay = replayMessages(events.map((event, index) => ({ seq: index + 1, event })));
    expect(replay.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
    expect(replay.messages[2]).toMatchObject({ toolCallId: "read-1", content: "read output" });
    expect(replay.messages[3]).toMatchObject({ toolCallId: "write-1", isError: true });
    expect(replay.messages[3]?.content).toContain("unknown");
  });

  test("dedupes duplicate seq values", () => {
    const result = replayMessages([
      withEnvelope(started("s-dup", "hello"), 1, "s-dup", TS),
      withEnvelope(assistant("s-dup", "first"), 2, "s-dup", TS),
      withEnvelope(assistant("s-dup", "duplicate"), 2, "s-dup", TS),
      withEnvelope(assistant("s-dup", "second"), 3, "s-dup", TS),
    ]);

    expect(result.duplicateSeqs).toEqual([2]);
    expect(result.gaps).toEqual([]);
    expect(result.messages).toEqual([
      { role: "user", content: "hello", memorySource: "hello" },
      { role: "assistant", content: "first", reasoning: "", toolCalls: [] },
      { role: "assistant", content: "second", reasoning: "", toolCalls: [] },
    ]);
  });

  test("keeps the interactive summary in the replayed context", () => {
    const result = replayMessages([
      withEnvelope(started("s-summary", "hello"), 1, "s-summary", TS),
      withEnvelope(
        {
          type: "message.finished",
          sessionId: "s-summary",
          text: "answer",
          reasoning: "thought",
          toolCalls: [],
          summary: "<p>interactive</p>",
          complete: true,
        },
        2,
        "s-summary",
        TS,
      ),
    ]);

    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: "answer\n\n<summary><p>interactive</p></summary>",
      reasoning: "thought",
      toolCalls: [],
    });
  });

  test("does not duplicate a summary that was the whole answer", () => {
    const result = replayMessages([
      withEnvelope(started("s-summary-only", "hello"), 1, "s-summary-only", TS),
      withEnvelope(
        {
          type: "message.finished",
          sessionId: "s-summary-only",
          text: "interactive",
          reasoning: "",
          toolCalls: [],
          summary: "interactive",
          complete: true,
        },
        2,
        "s-summary-only",
        TS,
      ),
    ]);

    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: "<summary>interactive</summary>",
      reasoning: "",
      toolCalls: [],
    });
  });

  test("reports gaps", () => {
    const result = replayMessages([
      withEnvelope(started("s-gap", "hello"), 1, "s-gap", TS),
      withEnvelope(assistant("s-gap", "first"), 2, "s-gap", TS),
      withEnvelope(assistant("s-gap", "second"), 4, "s-gap", TS),
    ]);

    expect(result.gaps).toEqual([{ afterSeq: 2, beforeSeq: 4 }]);
    expect(result.messages).toHaveLength(3);
  });

  test("replays a two-turn tool conversation in call order", () => {
    const callA: ToolCall = { id: "call-a", name: "read", args: { path: "a.txt" } };
    const callB: ToolCall = { id: "call-b", name: "grep", args: { pattern: "x" } };
    const envelopes = [
      withEnvelope(started("s-tools", "do both"), 1, "s-tools", TS),
      withEnvelope(turnStarted("s-tools", 1), 2, "s-tools", TS),
      withEnvelope(
        { type: "message.delta", sessionId: "s-tools", text: "ignored" },
        3,
        "s-tools",
        TS,
      ),
      withEnvelope(assistant("s-tools", "", [callA, callB]), 4, "s-tools", TS),
      withEnvelope(usage("s-tools", 10, 4, 2), 5, "s-tools", TS),
      withEnvelope({ type: "tool.started", sessionId: "s-tools", call: callA }, 6, "s-tools", TS),
      withEnvelope({ type: "tool.started", sessionId: "s-tools", call: callB }, 7, "s-tools", TS),
      withEnvelope(
        {
          type: "tool.finished",
          sessionId: "s-tools",
          call: callB,
          result: { ok: false, output: "b detail", error: "boom" },
        },
        8,
        "s-tools",
        TS,
      ),
      withEnvelope(
        {
          type: "tool.finished",
          sessionId: "s-tools",
          call: callA,
          result: { ok: true, output: "a output" },
        },
        9,
        "s-tools",
        TS,
      ),
      withEnvelope(usage("s-tools", 5, 2, 0), 10, "s-tools", TS),
      withEnvelope(
        { type: "turn.finished", sessionId: "s-tools", turn: 1, reason: "tool_use" },
        11,
        "s-tools",
        TS,
      ),
      withEnvelope(turnStarted("s-tools", 2), 12, "s-tools", TS),
      withEnvelope(assistant("s-tools", "done"), 13, "s-tools", TS),
      withEnvelope(
        { type: "turn.finished", sessionId: "s-tools", turn: 2, reason: "end" },
        14,
        "s-tools",
        TS,
      ),
      withEnvelope(
        {
          type: "session.finished",
          sessionId: "s-tools",
          result: {
            sessionId: "s-tools",
            pass: false,
            stopReason: "end",
            summary: "done",
            turns: 2,
            usage: { input: 15, output: 6, cached: 2 },
          },
        },
        15,
        "s-tools",
        TS,
      ),
    ];

    const result = replayMessages(envelopes);
    expect(result.gaps).toEqual([]);
    expect(result.duplicateSeqs).toEqual([]);
    expect(result.usage).toEqual({ input: 15, output: 6, cached: 2 });
    expect(result.messages).toEqual([
      { role: "user", content: "do both", memorySource: "do both" },
      { role: "assistant", content: "", reasoning: "", toolCalls: [callA, callB] },
      { role: "tool", toolCallId: "call-a", name: "read", content: "a output" },
      {
        role: "tool",
        toolCallId: "call-b",
        name: "grep",
        content: "Error: boom\n\nb detail",
        isError: true,
      },
      { role: "assistant", content: "done", reasoning: "", toolCalls: [] },
    ]);
  });

  test("continues seq and replays after restart", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const sessionId = "s-restart";

      const first = await DurableEventLog.open(path, sessionId);
      await expect(DurableEventLog.open(path, sessionId)).rejects.toThrow("already open");
      await first.append(started(sessionId, "hello"));
      await first.append(assistant(sessionId, "first answer"));
      await first.close();

      const second = await DurableEventLog.open(path, sessionId);
      await second.append(assistant(sessionId, "second answer"));
      await second.close();

      const { envelopes, corrupt } = await readTolerant(path);
      expect(corrupt).toEqual([]);
      expect(envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 3]);

      const replayed = replayMessages(envelopes);
      expect(replayed.gaps).toEqual([]);
      expect(replayed.messages).toEqual([
        { role: "user", content: "hello", memorySource: "hello" },
        { role: "assistant", content: "first answer", reasoning: "", toolCalls: [] },
        { role: "assistant", content: "second answer", reasoning: "", toolCalls: [] },
      ]);
    });
  });
});
