import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { conversationOptions } from "../../src/app/conversation-options";
import { workerTool } from "../../src/app/worker-tool";
import { HarnessConfigSchema } from "../../src/config/schema";
import { pageStartIndex } from "../../src/context/compactor";
import { parseCompletionSignal } from "../../src/core/goal/completion";
import { deepCutIndex } from "../../src/core/loop/context";
import { PageRuntime } from "../../src/core/pages/runtime";
import { deterministicPage, originalRequest } from "../../src/core/pages/summary";
import { SubagentRegistry } from "../../src/core/subagents/registry";
import { SubagentRunner } from "../../src/core/subagents/runner";
import { createAnthropic } from "../../src/providers/anthropic";
import { ProviderFailure } from "../../src/providers/failover";
import { postStream } from "../../src/providers/http";
import { epochMs } from "../../src/providers/limit-windows";
import { familyFirstVersion, usesCompletionTokens } from "../../src/providers/model-family";
import { createOpenAiResponses } from "../../src/providers/openai-responses";
import { parseRateLimit, resetRateLimits } from "../../src/providers/rate-limit";
import { strictSchema } from "../../src/providers/schema";
import { StreamEvents } from "../../src/providers/sse";
import { TransportError } from "../../src/providers/transport";
import { withResourceLimits } from "../../src/terminal/resources";
import { parseApplyPatch, runApplyPatch } from "../../src/tools/apply-patch/run";
import { builtinTools } from "../../src/tools/builtin";
import { runEdit } from "../../src/tools/edit/run";
import { ToolRegistry } from "../../src/tools/registry";
import { repairToolInput } from "../../src/tools/repair";
import { defineTool } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { collect, request } from "../helpers/provider-adapters";
import { runtime } from "../helpers/runtime";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2_000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2_000,
};

afterEach(() => resetRateLimits());

describe("harness engineering v2 regressions", () => {
  test("withResourceLimits omits RLIMIT_AS so V8 and WebAssembly virtual memory can initialize", () => {
    const wrapped = withResourceLimits(["bun", "test"], {
      maxProcesses: 64,
      maxMemoryBytes: 4 * 1024 * 1024 * 1024,
      ports: null,
    });
    expect(wrapped.some((arg) => arg.startsWith("--as="))).toBe(false);
  });

  test("model-family parses dot-separated Claude versions and namespaced OpenAI reasoning models", () => {
    expect(familyFirstVersion("claude-opus-4.7")).toEqual({ major: 4, minor: 7 });
    expect(usesCompletionTokens("openai/gpt-6.2-sol")).toBe(true);
    expect(usesCompletionTokens("O3-mini")).toBe(true);
  });

  test("rate limit parsing treats small x-ratelimit-reset numbers as delta seconds and preserves limitKind on 200 exhaustion", async () => {
    const now = 1_800_000_000_000;
    expect(epochMs("60")).toBeUndefined();
    const parsed = parseRateLimit({
      status: 429,
      headers: { "x-ratelimit-reset": "60" },
      now,
    });
    expect(parsed?.resetAt).toBe(now + 60_000);

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok", {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "0",
            "x-ratelimit-reset-requests": "2s",
          },
        });
      },
    });
    try {
      const signal = new AbortController().signal;
      await postStream({
        url: server.url.toString(),
        headers: {},
        body: {},
        signal,
        providerId: "rpm-25",
      });
      const blocked = await postStream({
        url: server.url.toString(),
        headers: {},
        body: {},
        signal,
        providerId: "rpm-25",
      }).catch((err: unknown) => err);
      expect(blocked).toBeInstanceOf(TransportError);
      const failure = ProviderFailure.from(blocked);
      expect(failure.kind).toBe("rate_limit");
      expect(failure.status).toBe(429);
      expect(failure.limitKind).toBe("rate");
    } finally {
      server.stop(true);
    }
  });

  test("OpenAI Responses omits reasoning: none unless supported, forwards promptCacheKey, and drops unclosed max_tokens tool calls", async () => {
    let sentBody: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        sentBody = (await req.json()) as Record<string, unknown>;
        const sse = [
          'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_1","summary":[]}}',
          'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_trunc","call_id":"call_trunc","name":"write","arguments":"{\\"path\\":\\"a.ts\\""}}',
          'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
          "",
        ].join("\n\n");
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const provider = createOpenAiResponses(
        runtime(`http://127.0.0.1:${server.port}/v1`, { protocol: "openai-responses" }, "openai"),
      );
      const events = await collect(
        provider.stream(
          { ...request(), reasoning: "none", promptCacheKey: "flecten:s_123" },
          new AbortController().signal,
        ),
      );
      expect(sentBody.reasoning).toBeUndefined();
      expect(sentBody.prompt_cache_key).toBe("flecten:s_123");
      expect(events.some((event) => event.type === "tool_call")).toBe(false);
      expect(events.at(-1)).toEqual({ type: "done", reason: "max_tokens" });
    } finally {
      server.stop(true);
    }
  });

  test("Anthropic places cache_control on the trailing message block and omits unstopped tool_use blocks", async () => {
    let sentBody: Record<string, unknown> = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        sentBody = (await req.json()) as Record<string, unknown>;
        const sse = [
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"let me check"}}',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_trunc","name":"write","input":{}}}',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"x"}}',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":20}}',
          'event: message_stop\ndata: {"type":"message_stop"}',
          "",
        ].join("\n\n");
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const provider = createAnthropic(
        runtime(`http://127.0.0.1:${server.port}`, { protocol: "anthropic-messages" }, "anthropic"),
      );
      const events = await collect(
        provider.stream(
          { ...request(), temperature: 0.2, reasoning: "medium", maxTokens: 8_000 },
          new AbortController().signal,
        ),
      );
      expect(sentBody.temperature).toBeUndefined();
      const messages = sentBody.messages as Array<{ content: Array<Record<string, unknown>> }>;
      expect(messages.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
      const data = events.find((event) => event.type === "provider_data");
      expect(data).toEqual({
        type: "provider_data",
        data: { kind: "anthropic", blocks: [{ type: "text", text: "let me check" }] },
      });
    } finally {
      server.stop(true);
    }
  });

  test("repairToolInput rejects truncated JSON on mutating tools, preserves empty newString, and supports worker strict schema", () => {
    const tools = builtinTools();
    const write = tools.find((tool) => tool.name === "write");
    const edit = tools.find((tool) => tool.name === "edit");
    const read = tools.find((tool) => tool.name === "read");
    if (!write || !edit || !read) throw new Error("missing builtin tools");

    expect(repairToolInput(write, '{"path":"a.ts","content":"half').correction).toBeDefined();
    expect(repairToolInput(read, '{"path":"a.ts').correction).toBeUndefined();
    const deletion = repairToolInput(edit, {
      path: "a.ts",
      oldString: "remove",
      newString: "",
      new_string: "wrong-fallback",
    });
    expect(deletion.correction).toBeUndefined();
    expect(deletion.input.newString).toBe("");

    const control = workerTool(async () => ({}));
    expect(strictSchema(control.parameters).strict).toBe(true);
    expect(repairToolInput(control, { op: "status" }).input).toEqual({ operation: "status" });

    for (const tool of tools) {
      const transformed = strictSchema(tool.parameters);
      expect(transformed.strict).toBe(true);
      expect(JSON.stringify(transformed.schema)).not.toContain('"format":');
    }
    const unionStrict = strictSchema({
      type: "object",
      properties: {
        mode: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
      required: ["mode"],
    });
    expect(unionStrict.strict).toBe(true);
    expect(JSON.stringify(unionStrict.schema)).not.toContain('"oneOf"');

    const streamEvents = new StreamEvents();
    expect(() => streamEvents.fail("server", "No available accounts")).toThrow(
      "No available accounts",
    );
  });

  test("ToolRegistry omits [full output] trailer when output fits within limits and edit gives mismatch hints", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-v2-"));
    try {
      const small = defineTool({
        name: "small",
        description: "small output",
        schema: z.object({}),
        execute: async () => ({ ok: true, output: "hello world" }),
      });
      const registry = new ToolRegistry([small], { limits });
      const res = await registry.run(
        { id: "c1", name: "small", args: {} },
        {
          sessionId: "s1",
          cwd,
          signal: new AbortController().signal,
          logDir: join(cwd, "logs"),
          limits,
          reads: new ReadTracker(),
        },
      );
      expect(res.trailer).toBe("");

      const file = join(cwd, "sample.ts");
      const content = "export function alpha() {\n  return 1;\n}\n";
      await writeFile(file, content);
      const reads = new ReadTracker();
      reads.record(file, content);
      const prefixed = await runEdit(
        {
          path: "sample.ts",
          oldString: "1: export function alpha() {\n2:   return 1;",
          newString: "x",
        },
        { cwd, reads },
      );
      expect(prefixed.ok).toBe(false);
      expect(prefixed.error).toContain("line-number prefixes");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("completion signal, deepCutIndex, synthetic pageStartIndex, and Talker grep/glob work cleanly", async () => {
    expect(
      parseCompletionSignal('24" monitor verified.\n\n<summary><p>Done</p></summary>'),
    ).toEqual({
      complete: true,
      summary: "<p>Done</p>",
      text: '24" monitor verified.',
    });

    const cut = deepCutIndex(
      [
        { role: "user", content: "Build feature" },
        { role: "assistant", content: "", toolCalls: [{ id: "1", name: "read", args: {} }] },
        { role: "tool", toolCallId: "1", name: "read", content: "x".repeat(40_000) },
      ],
      10,
    );
    expect(cut).toBe(1);

    const msgs = [
      { role: "user" as const, content: "Real human objective" },
      { role: "user" as const, content: "# Project memory", synthetic: true },
    ];
    expect(pageStartIndex(msgs)).toBe(0);
    expect(originalRequest(msgs)).toBe("Real human objective");
    expect(deterministicPage(msgs).rules).not.toContain("Project memory");

    const cwd = await mkdtemp(join(tmpdir(), "flecten-talker-"));
    try {
      const config = HarnessConfigSchema.parse({
        useDefaults: false,
        catalog: { autoRefresh: false },
      });
      const roles = await conversationOptions(
        {
          cwd,
          provider: { id: "p", model: "m", async *stream() {} },
          providerId: "p",
          model: "m",
          tools: new ToolRegistry(builtinTools(), { limits }),
          system: "sys",
          limits,
          maxOutputTokens: 1000,
          context: { window: 100_000, reserve: 1000 },
          loop: { maxTurns: 4, continuations: 0, parallelTools: true },
          logDir: (id) => join(cwd, id),
        },
        config,
        [],
        async () => ({}),
      );
      const talkerNames = roles.talker.tools.list().map((tool) => tool.name);
      expect(talkerNames).toContain("grep");
      expect(talkerNames).toContain("glob");
      expect(talkerNames).not.toContain("memory");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("PageRuntime handles strict-mode null optional fields, apply_patch handles stacked @@ anchors, and subagents discount cached tokens", async () => {
    const history = [
      {
        role: "assistant" as const,
        content: "",
        reasoning: "",
        toolCalls: [
          {
            id: "ctx-1",
            name: "context",
            args: {
              op: "begin",
              title: "Inspect parser",
              objective: "Check v1 and v2 rules",
              summary: null,
              evidence: null,
              next: null,
            },
          },
        ],
      },
      {
        role: "tool" as const,
        toolCallId: "ctx-1",
        name: "context",
        content: "# Active logical page",
      },
    ];
    const pages = new PageRuntime(history);
    expect(pages.active()).toEqual({
      title: "Inspect parser",
      objective: "Check v1 and v2 rules",
    });
    expect(pages.guard([{ id: "g1", name: "glob", args: { pattern: "*.ts" } }])).toBeUndefined();

    const cwd = await mkdtemp(join(tmpdir(), "flecten-patch-v2-"));
    try {
      await writeFile(join(cwd, "a.ts"), "class A {\n  foo() {\n    return 1;\n  }\n}\n", "utf8");
      const reads = new ReadTracker();
      reads.record(join(cwd, "a.ts"), "class A {\n  foo() {\n    return 1;\n  }\n}\n");
      const patch = [
        "*** Begin Patch",
        "*** Update File: a.ts",
        "@@",
        " class A {",
        "@@",
        "   foo() {",
        "-    return 1;",
        "+    return 2;",
        "   }",
        "*** End Patch",
      ].join("\n");
      expect(parseApplyPatch(patch).length).toBe(1);
      const res = await runApplyPatch(
        { patch },
        {
          sessionId: "s1",
          cwd,
          signal: new AbortController().signal,
          logDir: join(cwd, "logs"),
          limits,
          reads,
        },
      );
      expect(res.ok).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }

    const runner = new SubagentRunner(
      new SubagentRegistry([
        {
          id: "cached-role",
          name: "Cached Role",
          description: "role",
          systemPrompt: "prompt",
          allowedTools: ["read"],
          permissions: [],
          budget: { maxTurns: 10, maxTokens: 50_000 },
          resultSchema: z.object({ summary: z.string() }),
        },
      ]),
    );
    const subRes = await runner.run("cached-role", "check", {
      runChild: async () => ({
        text: '{"summary":"ok"}',
        usage: { input: 100_000, cached: 90_000, output: 2_000 },
        turns: 6,
      }),
    });
    expect(subRes.ok).toBe(true);
  });
});
