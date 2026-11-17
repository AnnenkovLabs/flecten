import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { ProviderResponseError } from "../../src/providers/response";
import type { ModelEvent } from "../../src/providers/types";
import { DurableEventLog, readTolerant } from "../../src/store/events/envelope";
import { replayMessages } from "../../src/store/events/replay";
import { ToolRegistry } from "../../src/tools/registry";
import { newId } from "../../src/util/ids";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

function provider(frames: unknown[], terminal = true) {
  const target = runtime("https://offline.invalid/v1");
  target.apiKey = "private-provider-key";
  target.fetch = async () =>
    new Response(
      [
        ...frames.map(
          (frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}`,
        ),
        ...(terminal ? ["data: [DONE]"] : []),
        "",
      ].join("\n\n"),
      { headers: { "content-type": "text/event-stream", "x-request-id": "req-safe-1" } },
    );
  return createOpenAiChat(target);
}

const tool = (extra: object = {}) => ({
  index: 0,
  id: "call-1",
  function: { name: "read", arguments: '{"path":"a.ts"}' },
  ...extra,
});
const cases: Array<[string, unknown[], string]> = [
  ["empty terminal", [], "empty_completion"],
  ["empty stop", [{ choices: [{ delta: {}, finish_reason: "stop" }] }], "empty_completion"],
  ["malformed JSON", ["{not-json}"], "malformed_json"],
  [
    "truncated tool JSON without finish reason",
    [
      {
        choices: [
          { delta: { tool_calls: [tool({ function: { name: "read", arguments: '{"path":' } })] } },
        ],
      },
    ],
    "incomplete_tool_arguments",
  ],
  [
    "missing tool identifier without finish reason",
    [{ choices: [{ delta: { tool_calls: [tool({ id: "" })] } }] }],
    "incomplete_tool_call",
  ],
  [
    "unknown tool without finish reason",
    [
      {
        choices: [
          { delta: { tool_calls: [tool({ function: { name: "unknown", arguments: "{}" } })] } },
        ],
      },
    ],
    "unknown_tool_call",
  ],
  [
    "reasoning only without finish reason",
    [{ choices: [{ delta: { reasoning_content: "private reasoning" } }] }],
    "reasoning_only",
  ],
  [
    "explicit content filter",
    [{ choices: [{ delta: { content: "private output" }, finish_reason: "content_filter" }] }],
    "content_filter",
  ],
  [
    "explicit refusal",
    [{ choices: [{ delta: { content: "private output" }, finish_reason: "refusal" }] }],
    "refusal",
  ],
  [
    "non-streaming response",
    [{ choices: [{ message: { content: "private output" }, finish_reason: "stop" }] }],
    "unsupported_choice",
  ],
  [
    "native response on Chat route",
    [{ candidates: [{ content: { parts: [{ text: "private output" }] } }] }],
    "unsupported_chunk",
  ],
  [
    "unknown delta",
    [{ choices: [{ delta: { native_text: "private output" } }] }],
    "unsupported_delta",
  ],
  [
    "wrong content type",
    [{ choices: [{ delta: { content: { text: "private output" } } }] }],
    "invalid_chunk",
  ],
  [
    "unknown finish",
    [{ choices: [{ delta: {}, finish_reason: "MAX_TOKENS" }] }],
    "unknown_finish_reason",
  ],
  [
    "inherited finish key",
    [{ choices: [{ delta: {}, finish_reason: "constructor" }] }],
    "unknown_finish_reason",
  ],
  [
    "missing tool body",
    [{ choices: [{ delta: {}, finish_reason: "tool_calls" }] }],
    "missing_tool_call",
  ],
  [
    "missing tool identifier",
    [{ choices: [{ delta: { tool_calls: [tool({ id: "" })] }, finish_reason: "tool_calls" }] }],
    "incomplete_tool_call",
  ],
  [
    "truncated tool JSON",
    [
      {
        choices: [
          {
            delta: {
              tool_calls: [tool({ function: { name: "read", arguments: '{"path":"a.ts"' } })],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ],
    "incomplete_tool_arguments",
  ],
  [
    "reasoning only",
    [{ choices: [{ delta: { reasoning_content: "private reasoning" }, finish_reason: "stop" }] }],
    "reasoning_only",
  ],
];

for (const [name, frames, outcome] of cases) {
  test(`Chat contract rejects ${name} before successful completion`, async () => {
    const events: ModelEvent[] = [];
    let error: unknown;
    try {
      for await (const event of provider(frames).stream(request(), new AbortController().signal))
        events.push(event);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error).toMatchObject({
      kind: "bad_request",
      retryable: false,
      response: { status: "failed", outcome, requestId: "req-safe-1" },
    });
    expect(events.some((event) => event.type === "done" || event.type === "tool_call")).toBe(false);
    expect(JSON.stringify((error as ProviderResponseError).response)).not.toContain("private");
  });
}

for (const finish of [undefined, null, ""]) {
  for (const [name, delta, reason] of [
    ["text", { content: "Привет. Всё отлично, готов к работе." }, "end"],
    ["tool calls", { tool_calls: [tool()] }, "tool_use"],
  ] as const) {
    test(`Chat contract accepts ${name} with ${String(finish)} finish reason and [DONE]`, async () => {
      const events = await collect(
        provider([
          { choices: [{ delta, ...(finish === undefined ? {} : { finish_reason: finish }) }] },
          { usage: { prompt_tokens: 120, completion_tokens: 30 } },
        ]).stream(request(), new AbortController().signal),
      );
      const done = events.at(-1);
      expect(done).toMatchObject({
        type: "done",
        reason,
        response: { status: "complete", outcome: reason, terminal: true, usage: "reported" },
      });
      expect(done?.type === "done" && done.response?.originalFinishReason).toBeUndefined();
      expect(events.filter((event) => event.type === "usage")).toHaveLength(1);
      if (name === "text") expect(events).toContainEqual({ type: "text", delta: delta.content });
      else
        expect(events).toContainEqual({
          type: "tool_call",
          id: "call-1",
          name: "read",
          args: { path: "a.ts" },
        });
    });
  }
}

test("Chat metadata distinguishes reported zero usage from missing usage", async () => {
  for (const reported of [true, false]) {
    const frames: unknown[] = [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }];
    if (reported) frames.push({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
    const events = await collect(provider(frames).stream(request(), new AbortController().signal));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      reason: "end",
      response: {
        originalFinishReason: "stop",
        terminal: true,
        textBytes: 2,
        usage: reported ? "reported" : "missing",
        requestId: "req-safe-1",
      },
    });
  }
});

test("a rejected completion still reports the usage received before the failure", async () => {
  const events: ModelEvent[] = [];
  try {
    for await (const event of provider([
      { usage: { prompt_tokens: 120, completion_tokens: 30 } },
      "{not-json}",
    ]).stream(request(), new AbortController().signal))
      events.push(event);
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderResponseError);
  }
  expect(events.filter((event) => event.type === "usage")).toEqual([
    { type: "usage", input: 120, output: 30, cached: 0 },
  ]);
  expect(events.at(-1)).toMatchObject({
    type: "response",
    response: { outcome: "malformed_json", usage: "reported" },
  });
});

test("truncated tool arguments retain max_tokens without inventing executable arguments", async () => {
  const events = await collect(
    provider([
      {
        choices: [
          {
            delta: {
              tool_calls: [tool({ function: { name: "read", arguments: '{"path":"a.ts"' } })],
            },
            finish_reason: "length",
          },
        ],
      },
    ]).stream(request(), new AbortController().signal),
  );
  expect(events.some((event) => event.type === "tool_call")).toBe(false);
  expect(events.at(-1)).toMatchObject({
    type: "done",
    reason: "max_tokens",
    response: { originalFinishReason: "length" },
  });
});

test("missing terminal preserves network recovery and safe response counters", async () => {
  const error = await collect(
    provider([{ choices: [{ delta: { content: "partial" } }] }], false).stream(
      request(),
      new AbortController().signal,
    ),
  ).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    kind: "network",
    retryable: true,
    response: { outcome: "incomplete", terminal: false, frames: 1, textBytes: 7 },
  });
});

const greeting = "Привет. Все отлично, готов к работе. Как твои дела, чем займемся сегодня?";
const sessions: Array<[string, unknown[], string]> = [
  ["empty response", [], "empty_completion"],
  ["greeting without finish reason", [{ choices: [{ delta: { content: greeting } }] }], "end"],
];
for (const [name, frames, outcome] of sessions) {
  test(`real session preserves ${name} without extra requests`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-chat-contract-"));
    const sessionId = newId("s");
    const path = join(cwd, "events.jsonl");
    const log = await DurableEventLog.open(path, sessionId);
    let calls = 0;
    const adapter = provider(frames);
    const limits = {
      maxOutputBytes: 5000,
      maxOutputLines: 100,
      bashTimeoutMs: 1000,
      readLimitLines: 100,
    };
    const session = createSession({
      cwd,
      sessionId,
      providerId: "offline",
      model: "test-model",
      provider: {
        ...adapter,
        stream(input, signal) {
          calls += 1;
          return adapter.stream(input, signal);
        },
      },
      tools: new ToolRegistry([], { limits }),
      limits,
      system: "test",
      maxOutputTokens: 100,
      context: { window: 10000, reserve: 100 },
      loop: { maxTurns: 4, continuations: 8, parallelTools: false },
      logDir: (id) => join(cwd, id),
      onEvent: (event) => log.append(event),
    });
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));
    try {
      const successful = outcome === "end";
      expect(await session.send({ type: "run", prompt: "привет как дела" })).toMatchObject({
        stopReason: successful ? "end" : "error",
      });
      expect(calls).toBe(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "provider.response",
          response: expect.objectContaining({ outcome, requestId: "req-safe-1" }),
        }),
      );
      expect(
        events.some((event) => event.type === "turn.finished" && event.reason === "continue_empty"),
      ).toBe(false);
      expect(events.some((event) => event.type === "error")).toBe(!successful);
      const expected = successful
        ? [expect.objectContaining({ role: "assistant", content: greeting })]
        : [];
      expect(session.getHistory().filter((message) => message.role === "assistant")).toEqual(
        expected,
      );
      await session.flush();
      await log.close();
      const saved = await readTolerant(path);
      expect(saved.corrupt).toEqual([]);
      expect(
        replayMessages(saved.envelopes).messages.filter((message) => message.role === "assistant"),
      ).toEqual(expected);
    } finally {
      await session.dispose();
      await log.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
