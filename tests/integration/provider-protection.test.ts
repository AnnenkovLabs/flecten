import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { HarnessConfigSchema } from "../../src/config/schema";
import { emptyHookOutcome, type HookInput } from "../../src/core/hooks/types";
import { executeCalls } from "../../src/core/loop/tools";
import type { LoopEvent } from "../../src/core/loop/types";
import type { ToolCall, ToolResult } from "../../src/core/types";
import { createProvider } from "../../src/providers/registry";
import type { ModelEvent, ModelRequest } from "../../src/providers/types";
import { PermissionEngine } from "../../src/security/permissions";
import { ProviderProtection } from "../../src/security/provider-protection";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool, type ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { isObject } from "../../src/util/json";

const dirs: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const protections: ProviderProtection[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 1000,
  bashTimeoutMs: 1000,
  readLimitLines: 1000,
};
const sample = "fixture-private-value-with-no-vendor-prefix";

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const protection of protections.splice(0)) protection.vault.dispose();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function collect(source: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const result: ModelEvent[] = [];
  for await (const event of source) result.push(event);
  return result;
}

function request(content: string): ModelRequest {
  return {
    model: "model",
    system: "system",
    messages: [{ role: "user", content }],
    tools: [],
    maxTokens: 100,
  };
}

test("real transport masks protected payloads and leaves provider authentication functional", async () => {
  const bodies: string[] = [];
  const headers: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      bodies.push(await req.text());
      headers.push(req.headers.get("authorization") ?? "");
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  servers.push(server);
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "relay",
    model: "model",
    providers: {
      relay: {
        protocol: "openai-chat",
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: sample,
        models: { model: {} },
        protection: { enabled: true },
      },
    },
  });
  const active = createProvider(config).provider;
  if (active.protection) protections.push(active.protection);
  const input = request(`PASSWORD=${sample}`);
  await collect(active.stream(input, new AbortController().signal));
  expect(bodies[0]).not.toContain(sample);
  expect(bodies[0]).toContain("[[secret_");
  expect(headers[0]).toBe(`Bearer ${sample}`);
  expect(input.messages[0]?.content).toBe(`PASSWORD=${sample}`);
  const definition = config.providers.relay;
  if (!definition) throw new Error("Missing fixture provider");
  definition.protection = { enabled: false };
  await collect(createProvider(config).provider.stream(input, new AbortController().signal));
  expect(bodies[1]).toContain(sample);
});

test("injected undeclared, duplicate and incomplete calls never reach execution", async () => {
  const protection = new ProviderProtection({});
  protections.push(protection);
  const declared = {
    ...request("go"),
    tools: [{ name: "read", description: "Read", parameters: { type: "object" } }],
  };
  for (const events of [
    [
      { type: "tool_call", id: "x", name: "bash", args: { command: "irrelevant" } },
      { type: "done", reason: "tool_use" },
    ],
    [
      { type: "tool_call", id: "x", name: "read", args: { path: "a" } },
      { type: "tool_call", id: "x", name: "read", args: { path: "b" } },
    ],
    [{ type: "tool_call", id: "x", name: "read", args: { path: "a" } }],
  ] as ModelEvent[][]) {
    const delivered: ModelEvent[] = [];
    async function* source() {
      yield* events;
    }
    let failure: unknown;
    try {
      for await (const event of protection.events(source(), declared)) delivered.push(event);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(delivered.some((event) => event.type === "tool_call")).toBe(false);
  }
  async function* split() {
    yield { type: "text", delta: "PASSWORD=fixture-private-" } as const;
    yield { type: "text", delta: "value-with-no-vendor-prefix" } as const;
    yield { type: "done", reason: "end" } as const;
  }
  const safe = await collect(protection.events(split(), declared));
  expect(JSON.stringify(safe)).not.toContain(sample);
  expect(JSON.stringify(safe)).toContain("[[secret_");
  const opaque = "cross-field-opaque-credential-value";
  async function* crossField() {
    yield { type: "provider_data", data: { echoed: opaque } } as const;
    yield { type: "reasoning", delta: opaque } as const;
    yield { type: "text", delta: `PASSWORD=${opaque}` } as const;
    yield { type: "done", reason: "end" } as const;
  }
  expect(JSON.stringify(await collect(protection.events(crossField(), declared)))).not.toContain(
    opaque,
  );
});

test("read to edit roundtrip restores local values, requires human approval and never logs originals", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-provider-protection-"));
  dirs.push(cwd);
  await writeFile(join(cwd, ".env"), `CUSTOM_TOKEN=${sample}\n`);
  const protection = new ProviderProtection({});
  protections.push(protection);
  const tools = new ToolRegistry(builtinTools(), { limits });
  const permissions = new PermissionEngine({
    rules: [
      { action: "read", policy: "allow" },
      { action: "write", policy: "allow" },
    ],
  });
  let decisions = 0;
  const context: Omit<ToolContext, "signal"> = {
    cwd,
    sessionId: "protected-session",
    logDir: join(cwd, "logs"),
    limits,
    reads: new ReadTracker(),
    permissions,
    approvals: {
      async wait(prompt, _signal, authority) {
        decisions += 1;
        expect(prompt.humanOnly).toBe(true);
        expect(authority?.approve(prompt.id, "allow_always")?.choice).toBe("allow_once");
        return { choice: "allow_once", by: "user" };
      },
    },
  };
  const provider = { id: "protected", model: "model", protection, async *stream() {} };
  const options = {
    tools,
    provider,
    toolContext: context,
    signal: new AbortController().signal,
    parallelTools: false,
  };
  const events: LoopEvent[] = [];
  const hookInputs: HookInput[] = [];
  const guarded = {
    ...options,
    hooks: {
      async run(_event: string, input: HookInput) {
        hookInputs.push(input);
        return emptyHookOutcome();
      },
    },
  };
  const run = async (call: ToolCall) => {
    const results: ToolResult[] = [];
    await executeCalls([call], guarded, (event) => events.push(event), results);
    const result = results[0];
    if (!result) throw new Error("Missing tool result");
    return result;
  };
  const read = await run({ id: "read", name: "read", args: { path: ".env" } });
  expect(read.ok).toBe(true);
  expect(read.output).not.toContain(sample);
  expect(read.output).toContain("[[secret_");
  const tag = protection.vault.protect(sample);
  const edited = await run({
    id: "edit",
    name: "edit",
    args: {
      path: ".env",
      oldString: `CUSTOM_TOKEN=${tag}`,
      newString: `CUSTOM_TOKEN=${tag}\nFLAG=true`,
    },
  });
  expect(edited.ok).toBe(true);
  expect(decisions).toBe(1);
  expect(await readFile(join(cwd, ".env"), "utf8")).toBe(`CUSTOM_TOKEN=${sample}\nFLAG=true\n`);
  expect(JSON.stringify(events)).not.toContain(sample);
  expect(JSON.stringify(hookInputs)).not.toContain(sample);
  expect(JSON.stringify(hookInputs)).toContain("[[secret_");
  const logs = await Promise.all(
    (await readdir(join(cwd, "logs"))).map((file) => readFile(join(cwd, "logs", file), "utf8")),
  );
  expect(logs.join("\n")).not.toContain(sample);
  const forged = await run({
    id: "forged",
    name: "write",
    args: { path: "leaked", content: "[[secret_unknown]]" },
  });
  expect(forged.ok).toBe(false);
  expect(decisions).toBe(1);
});

test("protected delegation and module actions cannot execute without a human channel", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-protected-delegation-"));
  dirs.push(cwd);
  const protection = new ProviderProtection({});
  protections.push(protection);
  let executed = 0;
  const tools = new ToolRegistry(
    ["task", "module"].map((name) =>
      defineTool({
        name,
        source: name === "module" ? "module" : "builtin",
        description: "Fixture capability",
        schema: z.object({}).strict(),
        execute: async () => {
          executed += 1;
          return { ok: true, output: "Executed" };
        },
      }),
    ),
    { limits },
  );
  const results: ToolResult[] = [];
  await executeCalls(
    ["task", "module"].map((name) => ({ id: name, name, args: {} })),
    {
      tools,
      provider: { id: "relay", model: "model", protection, async *stream() {} },
      toolContext: {
        cwd,
        sessionId: "protected",
        logDir: join(cwd, "logs"),
        limits,
        reads: new ReadTracker(),
        permissions: new PermissionEngine({ rules: [{ action: "skill", policy: "allow" }] }),
      },
      signal: new AbortController().signal,
      parallelTools: false,
    },
    () => {},
    results,
  );
  expect(executed).toBe(0);
  expect(results).toHaveLength(2);
  expect(
    results.every(
      (result) => !result.ok && isObject(result.data) && result.data.kind === "approval",
    ),
  ).toBe(true);
});
