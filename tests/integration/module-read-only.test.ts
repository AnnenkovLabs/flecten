import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
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

test("revision-trusted read-only module tools use read policy and still honor MCP denies and checkpoints", async () => {
  const f = await moduleFixture();
  fixture = f;
  await f.app.acceptTrust();
  const name = "mcp_module_studio__runtime_measure";
  const manifest = {
    ...f.manifest,
    runtime: { ...f.manifest.runtime, readOnlyTools: [name] },
  };
  await Bun.write(join(f.root, ".flecten-module/module.json"), JSON.stringify(manifest));
  const source = await readModule(f.root);
  await f.app.modules.change({ operation: "trust", path: f.root, revision: source.revision });
  await f.app.modules.change({ operation: "interface", path: f.root, enabled: true });
  const config = f.app.settings().config;
  config.permissions = PermissionsConfigSchema.parse({
    ...config.permissions,
    read: "auto",
    mcp: "ask",
  });
  await f.app.saveSettings({ config });
  let approvals = 0;
  f.app.session.subscribe((event) => {
    if (event.type !== "approval.requested") return;
    approvals++;
    void f.app.session.send({ type: "approval.respond", id: event.approval.id, decision: "deny" });
  });
  const invoke = () =>
    f.app.session.send({
      type: "modules.invoke",
      sessionId: "preview",
      input: {
        name: "studio",
        surface: "studio",
        revision: source.revision,
        request: {
          type: "flecten.module.request",
          id: crypto.randomUUID(),
          method: "call",
          tool: name,
          arguments: { seconds: 2 },
        },
      },
    }) as Promise<ToolResult>;
  expect(await invoke()).toMatchObject({
    ok: true,
    output: expect.stringContaining('"frames":48'),
  });
  expect(await invoke()).toMatchObject({ ok: true });
  expect(approvals).toBe(0);
  expect(f.requests).toHaveLength(0);

  const blocked = f.app.settings().config;
  blocked.permissions = PermissionsConfigSchema.parse({
    ...blocked.permissions,
    rules: [{ action: "mcp", tool: name, policy: "deny" }],
  });
  await f.app.saveSettings({ config: blocked });
  expect(await invoke()).toMatchObject({ ok: false });
  expect(approvals).toBe(0);

  const checkpoint = f.app.settings().config;
  checkpoint.permissions = PermissionsConfigSchema.parse({
    ...checkpoint.permissions,
    rules: [{ action: "mcp", tool: name, policy: "ask", checkpoint: true }],
  });
  await f.app.saveSettings({ config: checkpoint });
  expect(await invoke()).toMatchObject({ ok: false });
  expect(approvals).toBe(1);

  // A changed declaration cannot retain the old package's native-code trust.
  await Bun.write(
    join(f.root, ".flecten-module/module.json"),
    JSON.stringify({ ...manifest, version: "1.0.1" }),
  );
  await f.app.modules.runtime.catalog.refresh(true);
  expect((await f.app.modules.state("preview")).modules[0]?.trusted).toBe(false);
  await expect(invoke()).rejects.toThrow("no longer enabled");
}, 30_000);
