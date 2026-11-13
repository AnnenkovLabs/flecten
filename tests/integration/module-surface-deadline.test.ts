import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { PermissionsConfigSchema } from "../../src/config/schema";
import type { ToolResult } from "../../src/core/types";
import { readModule } from "../../src/modules/package";
import { moduleFixture } from "../helpers/modules";

let fixture: Awaited<ReturnType<typeof moduleFixture>> | undefined;
afterEach(async () => {
  await fixture?.close();
  if (fixture) await rm(fixture.cwd, { recursive: true, force: true });
  fixture = undefined;
});

async function prepare() {
  const f = await moduleFixture();
  fixture = f;
  await f.app.acceptTrust();
  const source = await readModule(f.root);
  await f.app.modules.change({ operation: "interface", path: f.root, enabled: true });
  const config = f.app.settings().config;
  config.permissions = PermissionsConfigSchema.parse({ ...config.permissions, mcp: "ask" });
  await f.app.saveSettings({ config });
  const input = {
    name: "studio",
    surface: "studio",
    revision: source.revision,
    request: {
      type: "flecten.module.request" as const,
      id: "surface-request",
      method: "call" as const,
      tool: "mcp_module_studio__runtime_measure",
      arguments: { seconds: 2 },
    },
  };
  await f.app.session.send({
    type: "modules.invoke",
    sessionId: "surface-chat",
    input: {
      ...input,
      request: { type: "flecten.module.request", id: "catalog", method: "tools" },
    },
  });
  f.app.session.update({ approvalTimeoutMs: 80 });
  const invoke = () =>
    f.app.session.send({
      type: "modules.invoke",
      sessionId: "surface-chat",
      input,
    }) as Promise<ToolResult>;
  return { f, invoke };
}

test("idle surface approval expiry returns the typed permission result with the correlated request identity", async () => {
  const { f, invoke } = await prepare();
  const requested: string[] = [];
  f.app.session.subscribe((event) => {
    if (event.type === "approval.requested") requested.push(event.approval.callId ?? "");
  });
  expect(await invoke()).toMatchObject({
    ok: false,
    data: { kind: "permission", outcome: "timeout" },
  });
  expect(requested).toEqual(["module-ui-surface-request"]);
  expect(f.requests).toHaveLength(0);
  expect(f.app.session.peek().approvals).toBe(0);
});

test("an idle surface permission wait is cancelled by its exact tool identity without starting the backend", async () => {
  const { f, invoke } = await prepare();
  f.app.session.update({ approvalTimeoutMs: 10_000 });
  f.app.session.subscribe((event) => {
    if (event.type === "approval.requested")
      void f.app.session.send({
        type: "tool.cancel",
        sessionId: "surface-chat",
        callId: event.approval.callId ?? "",
      });
  });
  expect(await invoke()).toMatchObject({
    ok: false,
    data: { errorKind: "aborted", cancelled: true },
  });
  expect(f.requests).toHaveLength(0);
  expect(f.app.session.peek().approvals).toBe(0);
});
