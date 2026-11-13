import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { readModule } from "../../src/modules/package";
import { moduleFixture, runtimeVersion } from "../helpers/modules";

const fixtures: Awaited<ReturnType<typeof moduleFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
async function fixture() {
  const value = await moduleFixture();
  fixtures.push(value);
  return value;
}
const action = (operation: string, fields: Record<string, unknown> = {}) => ({
  name: "module",
  args: { operation, ...fields },
});
const text = (value: unknown) => JSON.stringify(value);

test("real agent lazily activates a module, runs SDK tools and hooks, hot loads new code without changing the cached prefix", async () => {
  const f = await fixture();
  await f.app.acceptTrust();
  await f.app.modules.change({ operation: "development", path: f.root, enabled: true });
  const hash = f.app.info().system.hash;
  f.script(async (_input, turn) => {
    if (turn === 0) return action("list");
    if (turn === 1) return action("activate", { name: "studio" });
    if (turn === 2) return { name: "read", args: { path: "guide.md" } };
    if (turn === 3)
      return action("call", {
        name: "studio",
        tool: "mcp_module_studio__runtime_measure",
        arguments: { seconds: 2 },
      });
    if (turn === 4) {
      await runtimeVersion(f.root, "V2");
      await Bun.write(
        join(f.root, "instructions.md"),
        "STUDIO_INSTRUCTIONS_V2: verify the final trailer.",
      );
      await f.app.modules.runtime.catalog.refresh(true);
      return action("tools", { name: "studio" });
    }
    if (turn === 5)
      return action("call", {
        name: "studio",
        tool: "mcp_module_studio__runtime_measure",
        arguments: { seconds: 3 },
      });
    return "<complete>Verified.</complete>";
  });
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  f.app.session.subscribe((event) => events.push(event));
  const result = await f.app.session.send({
    type: "run",
    sessionId: "studio-chat",
    prompt: "Make a trailer",
  });
  expect(result).toMatchObject({ stopReason: "done" });
  expect(text(f.requests[0])).not.toContain("STUDIO_INSTRUCTIONS");
  expect(text(f.requests[1])).not.toContain("STUDIO_GUIDE");
  expect(text(f.requests[2])).toContain("STUDIO_INSTRUCTIONS_V1");
  expect(text(f.requests[3])).toContain("STUDIO_HOOK_BLOCKED_READ");
  expect(text(f.requests[4])).toContain('\\"version\\":\\"V1\\"');
  expect(text(f.requests[5])).toContain("STUDIO_INSTRUCTIONS_V2");
  expect(text(f.requests[6])).toContain('\\"version\\":\\"V2\\"');
  for (let index = 1; index < f.requests.length; index++) {
    const previous = f.requests[index - 1];
    const current = f.requests[index];
    expect(current?.tools).toEqual(f.requests[0]?.tools);
    expect(current?.messages.slice(0, previous?.messages.length)).toEqual(previous?.messages);
  }
  expect(f.app.info().system.hash).toBe(hash);
  expect((await f.app.modules.state("unrelated-chat")).active).toEqual([]);
  expect((await f.app.modules.state("studio-chat")).surfaces).toMatchObject([{ id: "studio" }]);
  await f.app.session.flush();
  const saved = await f.app.readSession("studio-chat");
  expect(
    saved.some(
      (event) => event.type === "notice.applied" && event.moduleReferences?.[0]?.name === "studio",
    ),
  ).toBe(true);
  expect(events.some((event) => event.type === "hook.finished")).toBe(true);
}, 30_000);

test("surface RPC validates schemas and grants, uses real MCP permissions, and preserves the model transcript", async () => {
  const f = await fixture();
  await f.app.acceptTrust();
  f.script((_input, turn) =>
    turn === 0 ? action("activate", { name: "studio" }) : "<complete>Ready.</complete>",
  );
  await f.app.session.send({ type: "run", sessionId: "surface-chat", prompt: "Open studio" });
  const handlers = createHandlers(f.app, () => undefined);
  const surface = (await f.app.modules.state("surface-chat")).surfaces[0];
  if (!surface) throw new Error("Surface missing");
  const base = {
    sessionId: "surface-chat",
    name: "studio",
    surface: "studio",
    revision: surface.revision,
  };
  expect(await handlers["modules.surface"]({ type: "modules.surface", ...base })).toMatchObject({
    moduleHtml: expect.stringContaining("Trailer studio"),
  });
  const invoke = (tool: string, args: unknown) =>
    handlers["modules.invoke"]({
      type: "modules.invoke",
      ...base,
      request: {
        type: "flecten.module.request",
        id: "ui-1",
        method: "call",
        tool,
        arguments: args,
      },
    });
  expect(await invoke("mcp_module_studio__runtime_measure", { seconds: 2 })).toMatchObject({
    moduleResult: { ok: true, output: expect.stringContaining('"frames":48') },
  });
  expect(await invoke("mcp_module_studio__runtime_measure", { seconds: "bad" })).toMatchObject({
    moduleResult: { ok: false },
  });
  await expect(invoke("mcp_module_studio__runtime_wait", {})).rejects.toThrow("not granted");
  await expect(
    handlers["modules.surface"]({ type: "modules.surface", ...base, revision: "stale" }),
  ).rejects.toThrow("changed");
  const settings = f.app.settings().config;
  settings.permissions = {
    ...settings.permissions,
    rules: [{ action: "mcp", policy: "deny" }],
  } as NonNullable<typeof settings.permissions>;
  await f.app.saveSettings({ config: settings });
  expect(await invoke("mcp_module_studio__runtime_measure", { seconds: 2 })).toMatchObject({
    moduleResult: { ok: false, data: { kind: "permission" } },
  });
  const before = [...f.app.session.getHistory()];
  f.script(() => "<complete>Still ready.</complete>");
  await f.app.session.send({ type: "run", sessionId: "surface-chat", prompt: "Continue" });
  expect(f.app.session.getHistory().slice(0, before.length)).toEqual(before);
  expect(text(await f.app.readSession("surface-chat"))).not.toContain("module-ui-");
}, 30_000);

test("hash trust revokes modified modules, and trust/config changes keep the stable tool and system prefix", async () => {
  const f = await fixture();
  await f.app.acceptTrust();
  const hash = f.app.info().system.hash;
  f.script((_input, turn) =>
    turn === 0 ? action("activate", { name: "studio" }) : "<complete>Ready.</complete>",
  );
  await f.app.session.send({ type: "run", sessionId: "trust-chat", prompt: "Use studio" });
  await runtimeVersion(f.root, "changed");
  await f.app.modules.runtime.catalog.refresh(true);
  expect((await f.app.modules.state()).modules[0]?.trusted).toBe(false);
  f.script(() => "<complete>Unavailable.</complete>");
  await f.app.session.send({ type: "run", sessionId: "trust-chat", prompt: "Continue" });
  expect((await f.app.modules.state("trust-chat")).active).toEqual([]);
  expect(text(f.requests.at(-1))).toContain("needs trust review");
  const updated = await readModule(f.root);
  await expect(
    f.app.modules.change({ operation: "trust", path: f.root, revision: "stale" }),
  ).rejects.toThrow("changed");
  await f.app.modules.change({ operation: "trust", path: f.root, revision: updated.revision });
  expect(f.app.info().system.hash).toBe(hash);
  await f.app.session.send({ type: "run", sessionId: "trust-chat", prompt: "Try now" });
  expect((await f.app.modules.state("trust-chat")).active[0]?.revision).toBe(updated.revision);
}, 30_000);
