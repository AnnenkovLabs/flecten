import { describe, expect, test } from "bun:test";
import { EventJournal } from "../../src/app/event-journal";
import type { Event } from "../../src/core/types";

describe("live journal redaction", () => {
  test("buffers split credentials and flushes each stream before completion without losing words", () => {
    const journal = new EventJournal();
    const live: Array<Event & { seq: number }> = [];
    live.push(
      ...journal.accept({
        type: "session.started",
        sessionId: "s",
        provider: "p",
        model: "m",
        prompt: "go",
      }),
    );
    for (const text of ["Hello sk-ab", "cdefghijklmno", "pqrstuvwxyz. Done"])
      live.push(...journal.accept({ type: "message.delta", sessionId: "s", text }));
    live.push(
      ...journal.accept({
        type: "message.finished",
        sessionId: "s",
        text: "Hello sk-abcdefghijklmnopqrstuvwxyz. Done",
        reasoning: "",
        toolCalls: [],
      }),
    );
    const streamed = live
      .flatMap((event) => (event.type === "message.delta" ? [event.text] : []))
      .join("");
    expect(streamed).toBe("Hello [redacted:sk-a…wxyz]. Done");
    expect(JSON.stringify(live)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(journal.replay("s"))).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(live.map((event) => event.seq)).toEqual(live.map((_, index) => index + 1));
  });

  test("keeps reasoning and progress streams separate and redacts known split credentials", () => {
    const journal = new EventJournal(() => ["opaque credential"]);
    const live = [
      ...journal.accept({ type: "reasoning.delta", sessionId: "s", text: "why opaque " }),
      ...journal.accept({
        type: "tool_call.progress",
        sessionId: "s",
        index: 0,
        delta: "tool opa",
      }),
      ...journal.accept({ type: "reasoning.delta", sessionId: "s", text: "credential done" }),
      ...journal.accept({
        type: "tool_call.progress",
        sessionId: "s",
        index: 0,
        delta: "que credential done",
      }),
      ...journal.accept({
        type: "session.finished",
        sessionId: "s",
        result: {
          sessionId: "s",
          pass: true,
          stopReason: "end",
          summary: "done",
          turns: 1,
          usage: { input: 1, output: 1, cached: 0 },
        },
      }),
    ];
    const reasoning = live
      .flatMap((event) => (event.type === "reasoning.delta" ? [event.text] : []))
      .join("");
    const progress = live
      .flatMap((event) => (event.type === "tool_call.progress" ? [event.delta] : []))
      .join("");
    expect(reasoning).toBe("why [redacted] done");
    expect(progress).toBe("tool [redacted] done");
    expect(JSON.stringify(live)).not.toContain("opaque credential");
  });
});
