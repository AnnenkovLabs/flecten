import { afterEach, expect, test } from "bun:test";
import { HOOK_NAMES, HookRunSchema, HooksConfigSchema } from "../../shared/hooks";
import { testHook } from "../../src/app/hook-test";
import { createHandlers } from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { cleanupHooks, httpHook, serve, tempDir } from "../helpers/hooks";

afterEach(cleanupHooks);

function bridge(cwd: string) {
  const config = defaultConfig();
  const app = { testHook: (raw: unknown) => testHook(cwd, config, raw) } as AppService;
  return { config, handlers: createHandlers(app, () => undefined) };
}

test("bridge tests an unsaved disabled draft with an event-specific payload and no config mutation", async () => {
  const cwd = await tempDir();
  const seen: unknown[] = [];
  const url = serve(async (request) => {
    seen.push(await request.json());
    return Response.json({
      decision: "deny",
      reason: "Review this write",
      additionalContext: "Use the project formatter",
    });
  });
  const { config, handlers } = bridge(cwd);
  const draft = {
    ...httpHook(url),
    name: "Review writes",
    enabled: false,
    matcher: { tool: "write", pathPrefix: "src" },
  };
  const result = await handlers["hooks.test"]({
    type: "hooks.test",
    event: "preToolUse",
    hook: draft,
    sample: { toolName: "write", path: "src/main.ts" },
  });
  expect(result).toMatchObject({
    hookTest: {
      matched: true,
      blocked: true,
      reason: "Review this write",
      context: ["Use the project formatter"],
    },
  });
  expect(seen).toEqual([
    {
      event: "preToolUse",
      sessionId: "s_hook-test",
      cwd,
      toolName: "write",
      toolArgs: { path: "src/main.ts" },
    },
  ]);
  expect(config.hooks.preToolUse).toEqual([]);
});

test("draft condition misses are explicit and never execute the command", async () => {
  const cwd = await tempDir();
  let requests = 0;
  const url = serve(() => {
    requests++;
    return Response.json({});
  });
  const { handlers } = bridge(cwd);
  const result = await handlers["hooks.test"]({
    type: "hooks.test",
    event: "toolBatch",
    hook: { ...httpHook(url), matcher: { tool: "write", pathPrefix: "src" } },
    sample: { toolName: "read", path: "src/main.ts" },
  });
  expect(result).toMatchObject({ hookTest: { matched: false, blocked: false, runs: [] } });
  expect(requests).toBe(0);
});

test("batch test passes arguments inside the same tool entry as the runtime", async () => {
  const cwd = await tempDir();
  const seen: unknown[] = [];
  const url = serve(async (request) => {
    seen.push(await request.json());
    return Response.json({});
  });
  const { handlers } = bridge(cwd);
  const result = await handlers["hooks.test"]({
    type: "hooks.test",
    event: "toolBatch",
    hook: { ...httpHook(url), matcher: { tool: "bash", command: "bun test" } },
    sample: { toolName: "bash", command: "bun test" },
  });
  expect(result).toMatchObject({ hookTest: { matched: true, runs: [{ ok: true }] } });
  expect(seen).toEqual([
    {
      event: "toolBatch",
      sessionId: "s_hook-test",
      cwd,
      toolBatch: { tools: [{ name: "bash", args: { command: "bun test" } }], parallel: false },
    },
  ]);
});

test("saved hook diagnostics retain the original index and observer events cannot block", async () => {
  const cwd = await tempDir();
  const url = serve(() => Response.json({ decision: "deny", reason: "Observer" }));
  const { config } = bridge(cwd);
  config.hooks.postToolUse = HooksConfigSchema.parse({
    postToolUse: [httpHook(url), httpHook(url)],
  }).postToolUse;
  const result = await testHook(cwd, config, { event: "postToolUse", index: 1 });
  expect(result).toMatchObject({
    matched: true,
    blocked: false,
    runs: [{ index: 1, ok: true, decision: "deny" }],
  });
});

test("catalog drives the config keys and rejects misspelled events and unsafe inputs", async () => {
  expect(Object.keys(HooksConfigSchema.parse({}))).toEqual(HOOK_NAMES);
  expect(HooksConfigSchema.safeParse({ beforeToolUse: [] }).success).toBe(false);
  const cwd = await tempDir();
  const config = defaultConfig();
  await expect(
    testHook(cwd, config, {
      event: "preToolUse",
      hook: { type: "http", url: "file:///etc/passwd" },
    }),
  ).rejects.toThrow();
  await expect(
    testHook(cwd, config, {
      event: "preToolUse",
      hook: { command: "true" },
      sample: { injected: true },
    }),
  ).rejects.toThrow();
  const trace = {
    event: "preToolUse" as const,
    index: 4,
    id: "lint",
    name: "Lint writes",
    ok: false,
    blocked: true,
    durationMs: 3,
    exitCode: 2,
    timedOut: false,
    aborted: false,
    outputTruncated: false,
  };
  expect(HookRunSchema.parse(trace)).toEqual(trace);
});

test("text response mode runs ordinary command output without parsing logs as hook JSON", async () => {
  const cwd = await tempDir();
  const config = defaultConfig();
  const result = await testHook(cwd, config, {
    event: "preToolUse",
    hook: { command: "printf 'Formatting complete\\n'", responseFormat: "text", failClosed: true },
  });
  expect(result).toMatchObject({
    matched: true,
    blocked: false,
    context: [],
    runs: [{ ok: true, output: "Formatting complete" }],
  });
  const strictJson = await testHook(cwd, config, {
    event: "preToolUse",
    hook: { command: "printf 'Formatting complete\\n'", responseFormat: "json", failClosed: true },
  });
  expect(strictJson).toMatchObject({ blocked: true, runs: [{ ok: false }] });
});

test("permission examples choose their action explicitly and never infer shell intent from text", async () => {
  const cwd = await tempDir();
  const config = defaultConfig();
  const url = serve(() => Response.json({}));
  const draft = { ...httpHook(url), matcher: { tool: "bash", command: "bun test" } };
  const shell = await testHook(cwd, config, {
    event: "permission",
    hook: draft,
    sample: { permissionAction: "shell", toolName: "bash", command: "bun test" },
  });
  expect(shell.matched).toBe(true);
});
