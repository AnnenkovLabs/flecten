import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { createAnthropic } from "../../src/providers/anthropic";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import type { ModelProvider, ProviderRuntime } from "../../src/providers/types";
import { DurableEventLog } from "../../src/store/events/envelope";
import { readSession } from "../../src/store/events/read";
import { replayMessages } from "../../src/store/events/replay";
import { sessionPaths } from "../../src/store/paths";
import { ToolRegistry } from "../../src/tools/registry";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

const directories: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "liquid-provider-replay-"));
  directories.push(path);
  return path;
}

function stream(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function transport(events: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const configured: ProviderRuntime = {
    ...runtime("https://provider.invalid/v1"),
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return stream(events);
    },
  };
  return { configured, bodies };
}

async function reopen(provider: ModelProvider, sessionId: string) {
  const cwd = await workspace();
  const path = sessionPaths(cwd, sessionId).events;
  const log = await DurableEventLog.open(path, sessionId);
  const options: SessionOptions = {
    cwd,
    provider: { ...provider, model: "test-model" },
    providerId: provider.id,
    model: "test-model",
    sessionId,
    responseFormat: "structured",
    tools: new ToolRegistry([], { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    logDir: (id) => sessionPaths(cwd, id).logs,
  };
  const first = createSession({ ...options, onEvent: (event) => log.append(event) });
  try {
    await first.send({ type: "run", prompt: "first", sessionId });
    await first.flush();
  } finally {
    await first.dispose();
    await log.close();
  }
  const saved = await readSession(cwd, sessionId);
  const replayed = replayMessages(saved.map((event, index) => ({ seq: index + 1, event })));
  const second = createSession({ ...options, loadHistory: async () => replayed.messages });
  try {
    await second.send({ type: "run", prompt: "continue", sessionId });
  } finally {
    await second.dispose();
  }
  return { saved, replayed };
}

describe("provider metadata across persisted session replay", () => {
  test("retains Responses commentary phase, native ids and encrypted reasoning on the next request", async () => {
    const items = [
      {
        id: "rs_native",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Plan" }],
        encrypted_content: "opaque-reasoning-content",
      },
      {
        id: "msg_commentary",
        type: "message",
        role: "assistant",
        phase: "commentary",
        status: "completed",
        content: [{ type: "output_text", text: "I will inspect the code.", annotations: [] }],
      },
      {
        id: "msg_final",
        type: "message",
        role: "assistant",
        phase: "final_answer",
        status: "completed",
        content: [{ type: "output_text", text: "Checked.", annotations: [] }],
      },
    ];
    const { configured, bodies } = transport([
      ...items.map((item) => ({ type: "response.output_item.done", item })),
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const { saved, replayed } = await reopen(createOpenAiResponses(configured), "s-responses");
    const providerData = { kind: "openai-responses", items };
    expect(saved.find((event) => event.type === "message.finished")).toMatchObject({
      providerData,
    });
    expect(replayed.messages.find((message) => message.role === "assistant")).toMatchObject({
      providerData,
    });
    expect(bodies).toHaveLength(2);
    const input = bodies[1]?.input as unknown[] | undefined;
    expect(input?.slice(1, -1)).toEqual(items);
  });

  test("retains Anthropic signed thinking and redacted blocks through disk and the next request", async () => {
    const signature = "opaque-thinking-signature";
    const blocks = [
      { type: "thinking", thinking: "Inspect the public entry point.", signature },
      { type: "redacted_thinking", data: "opaque-redacted-thinking" },
      { type: "text", text: "Checked." },
    ];
    const { configured, bodies } = transport([
      { type: "message_start", message: { usage: { input_tokens: 10 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: blocks[0]?.thinking },
      },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: blocks[1] },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Checked." } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const { saved, replayed } = await reopen(createAnthropic(configured), "s-anthropic");
    const providerData = { kind: "anthropic", blocks };
    expect(saved.find((event) => event.type === "message.finished")).toMatchObject({
      providerData,
    });
    expect(replayed.messages.find((message) => message.role === "assistant")).toMatchObject({
      providerData,
    });
    expect(bodies).toHaveLength(2);
    const messages = bodies[1]?.messages as Array<Record<string, unknown>>;
    expect(messages[1]).toEqual({ role: "assistant", content: blocks });
  });

  test("reads legacy messages without fabricating a Responses phase", async () => {
    const cwd = await workspace();
    const sessionId = "s-legacy-provider";
    const log = await DurableEventLog.open(sessionPaths(cwd, sessionId).events, sessionId);
    try {
      await log.append({
        type: "message.finished",
        sessionId,
        text: "Legacy answer",
        reasoning: "",
        toolCalls: [],
      });
    } finally {
      await log.close();
    }
    const saved = await readSession(cwd, sessionId);
    const { messages } = replayMessages(saved.map((event, index) => ({ seq: index + 1, event })));
    expect(messages[0]).not.toHaveProperty("providerData");
    const { configured, bodies } = transport([{ type: "response.completed", response: {} }]);
    await collect(
      createOpenAiResponses(configured).stream(
        { ...request(), messages },
        new AbortController().signal,
      ),
    );
    expect(bodies[0]?.input).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Legacy answer" }],
      },
    ]);
  });

  test("keeps secret redaction active inside native metadata", async () => {
    const cwd = await workspace();
    const sessionId = "s-provider-secret";
    const path = sessionPaths(cwd, sessionId).events;
    const log = await DurableEventLog.open(path, sessionId);
    const event: Event = {
      type: "message.finished",
      sessionId,
      text: "Checked",
      reasoning: "",
      toolCalls: [],
      providerData: { kind: "native", signature: "keep-signature", apiKey: "credential" },
    };
    try {
      await log.append(event);
    } finally {
      await log.close();
    }
    expect(await Bun.file(path).text()).not.toContain("credential");
    const saved = await readSession(cwd, sessionId);
    expect(saved[0]).toMatchObject({
      providerData: { kind: "native", signature: "keep-signature", apiKey: "[redacted]" },
    });
  });
});
