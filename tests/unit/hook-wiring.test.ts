import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { HooksConfigSchema } from "../../src/config/schema-sections";
import { PermissionEngine } from "../../src/security/permissions";
import { scriptedProvider } from "../helpers/fake-provider";
import { buildSession, cleanupHooks, httpHook, serve, tempDir } from "../helpers/hooks";

afterEach(cleanupHooks);

test("configured HTTP hooks govern the real tool batch, permission and subagent path", async () => {
  const cwd = await tempDir();
  const seen: Array<Record<string, unknown>> = [];
  const url = serve(async (request) => {
    const input = (await request.json()) as Record<string, unknown>;
    seen.push(input);
    return Response.json(
      input.event === "subagent" ? { decision: "deny", reason: "role blocked" } : {},
    );
  });
  const hooks = HooksConfigSchema.parse({
    toolBatch: [httpHook(url)],
    permission: [httpHook(url)],
    subagent: [httpHook(url)],
  });
  const provider = scriptedProvider([
    [
      {
        type: "tool_call",
        id: "task-1",
        name: "task",
        args: { agent: "scout", prompt: "inspect" },
      },
      { type: "tool_call", id: "read-1", name: "read", args: { path: "missing.txt" } },
      { type: "done", reason: "tool_use" },
    ],
    [
      { type: "text", delta: "finished" },
      { type: "done", reason: "end" },
    ],
  ]);
  const session = buildSession(provider, cwd, hooks);
  session.update({
    permissions: new PermissionEngine({ rules: [{ action: "read", policy: "allow" }] }),
  });
  const results: string[] = [];
  session.subscribe((event) => {
    if (event.type === "tool.finished") results.push(event.result.error ?? "");
  });
  await session.send({ type: "run", prompt: "inspect" });
  await session.dispose();
  expect(seen.map((input) => input.event)).toContain("toolBatch");
  expect(seen.map((input) => input.event)).toContain("subagent");
  expect(seen.map((input) => input.event)).toContain("permission");
  expect(results).toContain("role blocked");
});

test("a command hook gets explicit env but does not inherit provider credentials", async () => {
  const cwd = await tempDir();
  const prior = process.env.FLECTEN_PRIVATE_HOOK_TEST;
  process.env.FLECTEN_PRIVATE_HOOK_TEST = "must-not-leak";
  const hookPath = join(cwd, "hook.ts");
  await Bun.write(
    hookPath,
    `await Bun.stdin.text(); process.stdout.write(JSON.stringify({additionalContext: String(process.env.FLECTEN_PRIVATE_HOOK_TEST) + ':' + process.env.HOOK_EXPLICIT}));`,
  );
  const { createHookRunner } = await import("../../src/core/hooks/runner");
  try {
    const hooks = HooksConfigSchema.parse({
      sessionStart: [
        {
          command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookPath)}`,
          env: { HOOK_EXPLICIT: "allowed" },
        },
      ],
    });
    const result = await createHookRunner(hooks).run(
      "sessionStart",
      { sessionId: "s_hooks", cwd },
      new AbortController().signal,
    );
    expect(result.context).toEqual(["undefined:allowed"]);
  } finally {
    if (prior === undefined) delete process.env.FLECTEN_PRIVATE_HOOK_TEST;
    else process.env.FLECTEN_PRIVATE_HOOK_TEST = prior;
  }
});
