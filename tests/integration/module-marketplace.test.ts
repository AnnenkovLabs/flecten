import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MarketplaceStateSchema } from "../../shared/module-marketplace";
import { createHandlers } from "../../src/app/server-handlers";
import { readModule } from "../../src/modules/package";
import { moduleFixture } from "../helpers/modules";

const fixtures: Awaited<ReturnType<typeof moduleFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
async function fixture() {
  const f = await moduleFixture();
  fixtures.push(f);
  return f;
}
type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = Parameters<typeof fetch>[1];
function mockFetch(route: (input: FetchInput) => Promise<Response> | undefined) {
  const originalFetch = globalThis.fetch;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (input: FetchInput, options?: FetchOptions) => route(input) ?? originalFetch(input, options),
      { preconnect: originalFetch.preconnect },
    ),
  );
  return () => fetchMock.mockRestore();
}
test("the built-in marketplace stays empty without fetching an older remote catalog or changing installed modules", async () => {
  const f = await fixture();
  const requested: FetchInput[] = [];
  const restore = mockFetch((input) => {
    requested.push(input);
    return Promise.resolve(Response.json({ schemaVersion: 1, name: "Outdated", modules: [] }));
  });
  try {
    const handlers = createHandlers(f.app, () => {});
    for (const refresh of [false, true]) {
      const reply = await handlers["modules.marketplace"]({
        type: "modules.marketplace",
        action: "list",
        refresh,
      });
      const catalog = MarketplaceStateSchema.parse(reply?.moduleMarketplace);
      expect(catalog).toEqual({
        sources: [{ id: "bundled", name: "Flecten", bundled: true }],
        entries: [],
        errors: [],
      });
    }
    expect(requested).toEqual([]);
    expect((await f.app.modules.state()).modules.map((module) => module.name)).toContain("studio");
    await expect(
      f.app.modules.marketplace({
        action: "install",
        source: "bundled",
        name: "better-trailer",
        revision: "0".repeat(64),
      }),
    ).rejects.toThrow("Module is unavailable");
    const index = await Bun.file(join(import.meta.dir, "../../src/marketplace/index.json")).json();
    expect(index).toEqual({ schemaVersion: 1, name: "Flecten", modules: [] });
  } finally {
    restore();
  }
});

test("community catalogs persist, validate package hashes and paths, and disconnect without deleting installed modules", async () => {
  const f = await fixture();
  const root = join(f.cwd, "community-source");
  await mkdir(join(root, ".flecten-module"), { recursive: true });
  await Bun.write(
    join(root, ".flecten-module/module.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "community-guide",
      version: "1.0.0",
      description: "A community guide",
      instructions: ["guide.md"],
    }),
  );
  await Bun.write(join(root, "guide.md"), "Read this guide only when activated.");
  const module = await readModule(root);
  const url = "https://modules.example/catalog.json";
  const packageUrl = "https://modules.example/guide.json";
  const catalog = {
    schemaVersion: 1,
    name: "Community",
    modules: [
      {
        title: "Community guide",
        publisher: "Example",
        category: "workflow",
        manifest: module.manifest,
        revision: module.revision,
        packageUrl,
      },
    ],
  };
  const files = Object.fromEntries(
    [...module.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]),
  );
  let bundle: unknown = { schemaVersion: 1, files };
  const restore = mockFetch((input) => {
    if (input === url) return Promise.resolve(Response.json(catalog));
    if (input === packageUrl) return Promise.resolve(Response.json(bundle));
    return undefined;
  });
  try {
    await f.app.modules.marketplace({ action: "addSource", url });
    expect(f.app.settings().config.modules?.marketplaces).toContain(url);
    const install = {
      action: "install",
      source: url,
      name: module.manifest.name,
      revision: module.revision,
    };
    bundle = {
      schemaVersion: 1,
      files: { ...files, "guide.md": Buffer.from("Changed bytes").toString("base64") },
    };
    await expect(f.app.modules.marketplace(install)).rejects.toThrow("does not match");
    expect(
      await Bun.file(
        join(f.cwd, ".flecten/modules/community-guide/.flecten-module/module.json"),
      ).exists(),
    ).toBe(false);
    bundle = { schemaVersion: 1, files: { "../escape": "YQ==" } };
    await expect(f.app.modules.marketplace(install)).rejects.toThrow();
    bundle = { schemaVersion: 1, files };
    const installed = await f.app.modules.marketplace(install);
    expect(
      installed.moduleState.modules.find((item) => item.name === module.manifest.name),
    ).toMatchObject({ trusted: false, enabled: false });
    const disconnected = await f.app.modules.marketplace({ action: "removeSource", url });
    expect(disconnected.moduleMarketplace.entries.some((item) => item.source === url)).toBe(false);
    expect(
      disconnected.moduleState.modules.some((item) => item.name === module.manifest.name),
    ).toBe(true);
    expect(f.app.settings().config.modules?.marketplaces).not.toContain(url);
  } finally {
    restore();
  }
});

test("unavailable catalogs keep the empty built-in source usable and unsafe URLs fail before fetching", async () => {
  const f = await fixture();
  const restore = mockFetch((input) => {
    if (input === "https://offline.example/catalog.json")
      return Promise.reject(new Error("Offline. Retry when connected."));
    return undefined;
  });
  try {
    expect(() =>
      f.app.modules.marketplace({ action: "addSource", url: "http://example.org/modules.json" }),
    ).toThrow();
    expect(() =>
      f.app.modules.marketplace({
        action: "addSource",
        url: "https://user:secret@example.org/catalog",
      }),
    ).toThrow();
    const listing = await f.app.modules.marketplace({ action: "list" });
    expect(listing.moduleMarketplace.entries).toEqual([]);
    await expect(
      f.app.modules.marketplace({
        action: "install",
        source: "bundled",
        name: "better-trailer",
        revision: "0".repeat(64),
      }),
    ).rejects.toThrow("Module is unavailable");
    const next = structuredClone(f.app.settings().config);
    if (!next.modules) throw new Error("Missing module configuration");
    next.modules.marketplaces = ["https://offline.example/catalog.json"];
    await f.app.saveSettings({ config: next });
    const result = await f.app.modules.marketplace({ action: "list", refresh: true });
    expect(result.moduleMarketplace.entries).toEqual([]);
    expect(result.moduleMarketplace.errors).toEqual([
      { source: "https://offline.example/catalog.json", message: "Offline. Retry when connected." },
    ]);
  } finally {
    restore();
  }
});

test("an explicit HTTPS catalog installs dependencies without trusting them and uses the normal activation path", async () => {
  const f = await fixture();
  const url = "https://modules.example/workflows.json";
  const names = ["frame-service", "frame-workflow"];
  const sources = await Promise.all(
    names.map((name) => readModule(join(import.meta.dir, "../fixtures/modules", name))),
  );
  const bundles = new Map<string, unknown>();
  const catalog = {
    schemaVersion: 1,
    name: "Workflow examples",
    modules: sources.map((module) => {
      const packageUrl = `https://modules.example/${module.manifest.name}.json`;
      bundles.set(packageUrl, {
        schemaVersion: 1,
        files: Object.fromEntries(
          [...module.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]),
        ),
      });
      return {
        title: module.manifest.name,
        publisher: "Example",
        category: "workflow",
        manifest: module.manifest,
        revision: module.revision,
        packageUrl,
      };
    }),
  };
  const restore = mockFetch((input) => {
    if (input === url) return Promise.resolve(Response.json(catalog));
    const bundle = bundles.get(String(input));
    return bundle ? Promise.resolve(Response.json(bundle)) : undefined;
  });
  try {
    const listing = await f.app.modules.marketplace({ action: "addSource", url });
    const workflow = listing.moduleMarketplace.entries.find(
      (entry) => entry.name === "frame-workflow",
    );
    if (!workflow) throw new Error("Missing workflow from the explicit catalog");
    const result = await f.app.modules.marketplace({ action: "install", ...workflow });
    expect(result.moduleState.active).toEqual([]);
    expect(result.moduleState.services ?? []).toEqual([]);
    for (const name of names) {
      expect(result.moduleState.modules.find((module) => module.name === name)).toMatchObject({
        trusted: false,
        enabled: false,
      });
    }
    const path = join(f.cwd, ".flecten/modules/frame-workflow");
    const original = await readModule(path);
    await expect(f.app.modules.marketplace({ action: "install", ...workflow })).rejects.toThrow(
      "already installed",
    );
    expect((await readModule(path)).revision).toBe(original.revision);
    await f.app.acceptTrust();
    for (const name of names) {
      const module = result.moduleState.modules.find((module) => module.name === name);
      if (!module) throw new Error(`Missing installed module: ${name}`);
      await f.app.modules.change({
        operation: "trust",
        path: module.path,
        revision: module.revision,
      });
    }
    f.script((_input, index) =>
      index === 0
        ? { name: "module", args: { operation: "activate", name: "frame-workflow" } }
        : "<complete>Ready.</complete>",
    );
    await f.app.session.send({
      type: "run",
      sessionId: "marketplace-chat",
      prompt: "Activate the frame workflow module.",
    });
    const state = await f.app.modules.state("marketplace-chat");
    expect(state.active.map((module) => module.name)).toContain("frame-workflow");
    expect(state.services).toContainEqual({
      owner: "frame-service",
      service: "trailer.frames@1",
      mode: "provide",
    });
    const saved = JSON.parse(await Bun.file(join(f.cwd, "flecten.config.json")).text());
    expect(saved.modules.dirs).toContain(path);
  } finally {
    restore();
  }
});
