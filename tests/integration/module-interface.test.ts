import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { readModule } from "../../src/modules/package";
import { moduleFixture } from "../helpers/modules";

let f: Awaited<ReturnType<typeof moduleFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  if (f) await rm(f.cwd, { recursive: true, force: true });
  f = undefined;
});

test("selected interfaces load before any model run, authorize explicit grants and lazily start guarded tools", async () => {
  f = await moduleFixture();
  await f.app.acceptTrust();
  const manifest = {
    ...f.manifest,
    styles: ["theme.css"],
    surfaces: f.manifest.surfaces.map((s) => ({
      ...s,
      placement: { selector: '[data-harness-region="shell"]', position: "replace" },
      harness: { state: true, events: true, commands: ["run", "interface.styles"] },
    })),
  };
  await Bun.write(join(f.root, "theme.css"), ":root{--bg:#182025}");
  await Bun.write(join(f.root, ".flecten-module/module.json"), JSON.stringify(manifest));
  const source = await readModule(f.root);
  await f.app.modules.change({ operation: "trust", path: f.root, revision: source.revision });
  const handlers = createHandlers(f.app, () => undefined);
  const base = { name: "studio", surface: "studio", revision: source.revision };
  await expect(handlers["modules.styles"]({ type: "modules.styles", ...base })).rejects.toThrow(
    "changed",
  );
  const hash = f.app.info().system.hash;
  await f.app.modules.change({ operation: "interface", path: f.root, enabled: true });
  expect(await handlers["modules.styles"]({ type: "modules.styles", ...base })).toEqual({
    moduleStyles: [":root{--bg:#182025}"],
  });
  expect(await handlers["modules.surface"]({ type: "modules.surface", ...base })).toMatchObject({
    moduleHtml: expect.stringContaining("Trailer studio"),
  });
  const state = await f.app.modules.state();
  expect(state.active).toEqual([]);
  expect(state.interfaces).toMatchObject([{ module: "studio", styles: 1 }]);
  expect(f.requests).toHaveLength(0);
  const authorize = (request: unknown) =>
    handlers["modules.authorize"]({ type: "modules.authorize", ...base, request });
  const request = { type: "flecten.module.request", id: "grant", method: "snapshot" };
  expect(await authorize(request)).toEqual({ moduleAuthorized: true });
  expect(
    await authorize({ ...request, method: "request", command: { type: "run", prompt: "Task" } }),
  ).toEqual({ moduleAuthorized: true });
  const themeRequest = {
    ...request,
    method: "request",
    command: { type: "interface.styles", css: ":root{--bg:#000}" },
  };
  expect(await authorize(themeRequest)).toEqual({ moduleAuthorized: true });
  await expect(
    authorize({ ...request, method: "request", command: { type: "settings.save", config: {} } }),
  ).rejects.toThrow("not granted");
  expect(
    await handlers["modules.invoke"]({
      type: "modules.invoke",
      ...base,
      sessionId: "custom-shell",
      request: {
        ...request,
        method: "call",
        tool: "mcp_module_studio__runtime_measure",
        arguments: { seconds: 2 },
      },
    }),
  ).toMatchObject({ moduleResult: { ok: true, output: expect.stringContaining('"frames":48') } });
  expect(f.requests).toHaveLength(0);
  await f.app.session.send({
    type: "run",
    sessionId: "custom-shell",
    prompt: "Continue in this shell",
  });
  expect(JSON.stringify(f.requests[0])).toContain("STUDIO_INSTRUCTIONS_V1");
  expect(f.app.info().system.hash).toBe(hash);
  await f.app.modules.change({ operation: "interface", path: f.root, enabled: false });
  await expect(
    handlers["modules.authorize"]({
      type: "modules.authorize",
      ...base,
      sessionId: "custom-shell",
      request: themeRequest,
    }),
  ).rejects.toThrow("Select this module interface");
  await f.app.modules.change({ operation: "interface", path: f.root, enabled: true });
  await Bun.write(join(f.root, "theme.css"), ":root{--bg:#000}");
  await f.app.modules.runtime.catalog.refresh(true);
  expect((await f.app.modules.state()).interfaces).toEqual([]);
  await expect(authorize(request)).rejects.toThrow("not trusted");
}, 30_000);
