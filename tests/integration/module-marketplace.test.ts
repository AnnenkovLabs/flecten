import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FLECTEN_MARKETPLACE_URL, MarketplaceStateSchema } from "../../shared/module-marketplace";
import { createHandlers } from "../../src/app/server-handlers";
import { BUNDLED_MODULES } from "../../src/modules/marketplace";
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
/** The repository is private until publication; the bundled source must fall back to local files. */
function privateRepository() {
  return mockFetch((input) =>
    input === FLECTEN_MARKETPLACE_URL
      ? Promise.reject(new Error("Repository catalog is unavailable."))
      : undefined,
  );
}

test("marketplace protocol installs bundled dependencies without executing or trusting them, then uses the existing activation path", async () => {
  const f = await fixture();
  const restore = privateRepository();
  try {
    const handlers = createHandlers(f.app, () => {});
    const reply = await handlers["modules.marketplace"]({
      type: "modules.marketplace",
      action: "list",
    });
    const catalog = MarketplaceStateSchema.parse(reply?.moduleMarketplace);
    expect(catalog.errors).toEqual([]);
    expect(catalog.entries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "better-trailer",
        "studio-harness",
        "frame-workflow",
        "frame-service",
        "sqlite-journal",
      ]),
    );
    const workflow = catalog.entries.find((entry) => entry.name === "frame-workflow");
    if (!workflow) throw new Error("Missing bundled workflow");
    const result = await f.app.modules.marketplace({ action: "install", ...workflow });
    expect(result.moduleState.active).toEqual([]);
    for (const name of ["frame-service", "frame-workflow"]) {
      expect(result.moduleState.modules.find((module) => module.name === name)).toMatchObject({
        trusted: false,
        enabled: false,
      });
    }
    expect(result.moduleState.services ?? []).toEqual([]);
    const path = join(f.cwd, ".liquid/modules/frame-workflow");
    const original = await readModule(path);
    await expect(f.app.modules.marketplace({ action: "install", ...workflow })).rejects.toThrow(
      "already installed",
    );
    expect((await readModule(path)).revision).toBe(original.revision);
    await f.app.acceptTrust();
    for (const name of ["frame-service", "frame-workflow"]) {
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
    if (input === FLECTEN_MARKETPLACE_URL)
      return Promise.reject(new Error("Repository catalog is unavailable."));
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
        join(f.cwd, ".liquid/modules/community-guide/.flecten-module/module.json"),
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

test("unavailable catalogs leave bundled modules usable, unsafe URLs fail before fetching, and a changed listing cannot be installed", async () => {
  const f = await fixture();
  const restore = mockFetch((input) => {
    if (input === FLECTEN_MARKETPLACE_URL)
      return Promise.reject(new Error("Repository catalog is unavailable."));
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
    const entry = listing.moduleMarketplace.entries[0];
    if (!entry) throw new Error("Missing bundled entry");
    await expect(
      f.app.modules.marketplace({
        action: "install",
        source: entry.source,
        name: entry.name,
        revision: "0".repeat(64),
      }),
    ).rejects.toThrow("Catalog changed");
    const next = structuredClone(f.app.settings().config);
    if (!next.modules) throw new Error("Missing module configuration");
    next.modules.marketplaces = ["https://offline.example/catalog.json"];
    await f.app.saveSettings({ config: next });
    const result = await f.app.modules.marketplace({ action: "list", refresh: true });
    expect(result.moduleMarketplace.entries.some((entry) => entry.name === "better-trailer")).toBe(
      true,
    );
    expect(result.moduleMarketplace.errors).toEqual([
      { source: "https://offline.example/catalog.json", message: "Offline. Retry when connected." },
    ]);
  } finally {
    restore();
  }
});

test("published repository catalog matches module sources and installs over HTTPS once the repository is public", async () => {
  const f = await fixture();
  const marketRoot = join(import.meta.dir, "../../src/marketplace");
  const index = JSON.parse(await Bun.file(join(marketRoot, "index.json")).text()) as {
    modules: Array<{ manifest: { name: string }; revision: string; packageUrl: string }>;
  };
  const bundles = new Map<string, unknown>();
  for (const metadata of BUNDLED_MODULES) {
    const source = await readModule(join(marketRoot, "modules", metadata.name));
    const listed = index.modules.find((item) => item.manifest.name === metadata.name);
    if (!listed) throw new Error(`Published catalog is missing ${metadata.name}`);
    expect(listed.revision).toBe(source.revision);
    const bundle = JSON.parse(
      await Bun.file(join(marketRoot, "packages", `${metadata.name}.json`)).text(),
    ) as { files: Record<string, string> };
    const decoded = new Map<string, Uint8Array>(
      Object.entries(bundle.files).map(([path, encoded]) => [
        path,
        new Uint8Array(Buffer.from(encoded, "base64")),
      ]),
    );
    expect([...decoded]).toEqual([...source.files]);
    bundles.set(listed.packageUrl, bundle);
  }
  let packageDownloads = 0;
  const restore = mockFetch((input) => {
    if (input === FLECTEN_MARKETPLACE_URL) return Promise.resolve(Response.json(index));
    const bundle = bundles.get(String(input));
    if (bundle) {
      packageDownloads += 1;
      return Promise.resolve(Response.json(bundle));
    }
    return undefined;
  });
  try {
    const listing = await f.app.modules.marketplace({ action: "list", refresh: true });
    const catalog = MarketplaceStateSchema.parse(listing.moduleMarketplace);
    expect(catalog.errors).toEqual([]);
    const entry = catalog.entries.find((item) => item.name === "frame-workflow");
    if (!entry) throw new Error("Missing published workflow");
    expect(entry.source).toBe("bundled");
    const result = await f.app.modules.marketplace({
      action: "install",
      source: entry.source,
      name: entry.name,
      revision: entry.revision,
    });
    expect(packageDownloads).toBeGreaterThan(0);
    expect(
      result.moduleState.modules.find((module) => module.name === "frame-workflow"),
    ).toMatchObject({ trusted: false, enabled: false });
    const installed = await readModule(join(f.cwd, ".liquid/modules/frame-workflow"));
    const source = await readModule(join(marketRoot, "modules/frame-workflow"));
    expect(installed.revision).toBe(source.revision);
  } finally {
    restore();
  }
});
