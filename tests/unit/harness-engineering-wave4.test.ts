import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnthropic } from "../../src/providers/anthropic";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import { runTodo } from "../../src/tools/todo/run";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2_000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2_000,
};

describe("harness engineering wave 3 & 4", () => {
  test("OpenAI Responses sends sticky cache headers and parallel_tool_calls", async () => {
    let sentBody: Record<string, unknown> = {};
    let sentHeaders: Record<string, string> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        sentHeaders = Object.fromEntries(req.headers.entries());
        sentBody = (await req.json()) as Record<string, unknown>;
        return new Response(
          'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":50,"output_tokens":5,"input_tokens_details":{"cached_tokens":40}}}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    try {
      const provider = createOpenAiResponses(
        runtime(`http://127.0.0.1:${server.port}/v1`, { protocol: "openai-responses" }, "openai"),
      );
      await collect(
        provider.stream(
          { ...request(), parallelToolCalls: true, promptCacheKey: "flecten:s_sticky" },
          new AbortController().signal,
        ),
      );
      expect(sentBody.parallel_tool_calls).toBe(true);
      expect(sentHeaders.session_id).toBe("flecten:s_sticky");
      expect(sentHeaders.conversation_id).toBe("flecten:s_sticky");
    } finally {
      server.stop(true);
    }
  });

  test("Anthropic places dual rolling cache_control breakpoints across multi-turn history", async () => {
    let anthropicBody: Record<string, unknown> = {};
    const anthropicServer = Bun.serve({
      port: 0,
      async fetch(req) {
        anthropicBody = (await req.json()) as Record<string, unknown>;
        return new Response(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    try {
      const anthropic = createAnthropic(
        runtime(
          `http://127.0.0.1:${anthropicServer.port}`,
          { protocol: "anthropic-messages" },
          "anthropic",
        ),
      );
      await collect(
        anthropic.stream(
          {
            ...request(),
            messages: [
              { role: "user", content: "first turn" },
              { role: "assistant", content: "ack", reasoning: "", toolCalls: [] },
              { role: "user", content: "second turn" },
            ],
          },
          new AbortController().signal,
        ),
      );
      const msgs = anthropicBody.messages as Array<{ content: Array<Record<string, unknown>> }>;
      expect(msgs[0]?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
      expect(msgs[2]?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    } finally {
      anthropicServer.stop(true);
    }
  });

  test("todo op=set replaces checklist items in a single batch call", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-todo-set-"));
    try {
      const todoRes = await runTodo(
        {
          op: "set",
          items: [
            { content: "inspect codebase", status: "completed" },
            { content: "apply multi-file patch", status: "in_progress", priority: "high" },
          ],
        },
        {
          sessionId: "s_todo_batch",
          cwd,
          signal: new AbortController().signal,
          logDir: join(cwd, "logs"),
          limits,
          reads: new ReadTracker(),
        },
      );
      expect(todoRes.ok).toBe(true);
      expect(todoRes.output).toContain("# Todos (2)");
      expect(todoRes.output).toContain("[completed]");
      expect(todoRes.output).toContain("[in_progress] (high)");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
