import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerAutoRefresh } from "../../src/app/provider-auto-refresh";
import { type HarnessConfig, HarnessConfigSchema } from "../../src/config/schema";
import { resetCatalogCache } from "../../src/providers/catalog-source";

const dirs: string[] = [];
afterEach(async () => {
  resetCatalogCache();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-provider-refresh-"));
  dirs.push(cwd);
  let config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "relay",
    model: "active",
    catalog: { autoRefresh: false },
    providers: {
      relay: {
        protocol: "openai-chat",
        baseUrl: "https://refresh.test/v1",
        apiKey: "refresh-secret",
        modelAutoRefresh: { enabled: true },
        models: {
          active: { name: "Active", context: 8000, output: 1000, tools: false },
          gone: { name: "Gone" },
          custom: { name: "Mine", source: "manual" },
        },
        modelMetadataBaseline: {
          active: { name: "Active", context: 8000, output: 1000, tools: false },
          gone: { name: "Gone" },
          deleted: { name: "Deleted" },
        },
      },
    },
  });
  let commits = 0;
  let notifications = 0;
  const refresh = providerAutoRefresh({
    cwd,
    config: () => config,
    onRefresh: () => {
      notifications += 1;
    },
    async commit(next) {
      const update = typeof next === "function" ? next() : next;
      if (update === config) return;
      config = HarnessConfigSchema.parse(update);
      commits += 1;
    },
  });
  return {
    cwd,
    refresh,
    config: () => config,
    commits: () => commits,
    notifications: () => notifications,
    replace(next: HarnessConfig) {
      config = next;
    },
  };
}

function metadata() {
  return {
    data: [
      {
        id: "active",
        name: "Active",
        context_length: 64000,
        max_output_tokens: 4000,
        supports_tools: true,
        supports_reasoning: true,
        structured_output: true,
      },
      { id: "added", context_length: 32000 },
      { id: "deleted" },
    ],
  };
}

function mockFetch(implementation: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect: fetch.preconnect }),
  );
}

test("hourly refresh uses live policy, preserves edits, updates all metadata and never generates", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const fetcher = mockFetch(async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    return Response.json(url === "https://refresh.test/v1/models" ? metadata() : {});
  });
  const interval = spyOn(globalThis, "setInterval");
  const app = await setup();
  try {
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 3_600_000);
    expect(requests).toEqual([]);
    const provider = app.config().providers.relay;
    if (!provider) throw new Error("missing test provider");
    provider.models.active = { ...provider.models.active, context: 16000 };
    await app.refresh.refresh();
    expect(provider.modelAutoRefresh?.overwriteManual).toBe(false);
    expect(app.config().providers.relay?.models.active).toMatchObject({
      context: 16000,
      output: 4000,
      tools: true,
      reasoning: true,
      structuredOutput: true,
    });
    expect(app.config().providers.relay?.models.gone).toBeUndefined();
    expect(app.config().providers.relay?.models.deleted).toBeUndefined();
    expect(app.config().providers.relay?.models.custom?.name).toBe("Mine");
    expect(app.config().providers.relay?.models.added?.context).toBe(32000);
    expect(app.config().providers.relay?.modelMetadataBaseline?.active?.context).toBe(8000);
    const saved = app.config().providers.relay;
    if (!saved?.modelAutoRefresh) throw new Error("missing test policy");
    saved.modelAutoRefresh.overwriteManual = true;
    await app.refresh.refresh();
    expect(app.config().providers.relay?.models.active?.context).toBe(64000);
    expect(app.config().providers.relay?.models.deleted).toBeDefined();
    expect(app.config().providers.relay?.models.custom).toBeUndefined();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.filter((request) => request.url.endsWith("/models"))).toHaveLength(2);
    const current = app.config().providers.relay;
    if (!current?.modelAutoRefresh) throw new Error("missing test policy");
    current.modelAutoRefresh.enabled = false;
    const count = requests.length;
    await app.refresh.refresh();
    expect(requests).toHaveLength(count);
    expect(app.commits()).toBe(2);
  } finally {
    await app.refresh.dispose();
    interval.mockRestore();
    fetcher.mockRestore();
  }
});

test("refresh does not overlap or overwrite edits saved while discovery is running", async () => {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const seen = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = mockFetch(async (input) => {
    if (String(input) !== "https://refresh.test/v1/models") return Response.json({});
    entered();
    await wait;
    return Response.json(metadata());
  });
  const app = await setup();
  try {
    const first = app.refresh.refresh();
    expect(app.refresh.refresh()).toBe(first);
    await seen;
    const next = structuredClone(app.config());
    const provider = next.providers.relay;
    if (!provider?.modelAutoRefresh) throw new Error("missing test policy");
    provider.modelAutoRefresh.overwriteManual = true;
    provider.models.active = { ...provider.models.active, output: 2500 };
    next.maxOutputTokens = 500;
    app.replace(next);
    release();
    await first;
    expect(app.config().maxOutputTokens).toBe(500);
    expect(app.config().providers.relay?.models.active).toMatchObject({
      context: 64000,
      output: 2500,
    });
    const current = app.config().providers.relay;
    if (!current?.modelAutoRefresh) throw new Error("missing test policy");
    current.modelAutoRefresh.enabled = false;
    await app.refresh.refresh();
    expect(app.commits()).toBe(1);
  } finally {
    release();
    await app.refresh.dispose();
    fetcher.mockRestore();
  }
});

test("discovery results cannot restore a provider removed, disabled or moved during the request", async () => {
  for (const change of ["removed", "disabled", "moved"] as const) {
    const app = await setup();
    const fetcher = mockFetch(async (input) => {
      if (String(input) !== "https://refresh.test/v1/models") return Response.json({});
      const provider = app.config().providers.relay;
      if (!provider?.modelAutoRefresh) throw new Error("missing test policy");
      if (change === "removed") delete app.config().providers.relay;
      else if (change === "disabled") provider.modelAutoRefresh.enabled = false;
      else provider.baseUrl = "https://changed.test/v1";
      return Response.json(metadata());
    });
    try {
      await app.refresh.refresh();
      expect(app.commits()).toBe(0);
      expect(app.config().providers.relay?.models.added).toBeUndefined();
      if (change === "removed") expect(app.config().providers.relay).toBeUndefined();
    } finally {
      await app.refresh.dispose();
      fetcher.mockRestore();
    }
  }
});

test("vanished automatic models return while manual deletions remain protected", async () => {
  let models: { data: Record<string, unknown>[] } = metadata();
  const fetcher = mockFetch(async (input) =>
    Response.json(String(input) === "https://refresh.test/v1/models" ? models : {}),
  );
  const app = await setup();
  try {
    await app.refresh.refresh();
    expect(app.config().providers.relay?.models.gone).toBeUndefined();
    expect(app.config().providers.relay?.modelMetadataBaseline?.gone).toBeUndefined();
    models = { data: [{ id: "active" }] };
    await app.refresh.refresh();
    expect(app.config().providers.relay?.modelMetadataBaseline?.deleted).toBeDefined();
    models = { data: [{ id: "active" }, { id: "gone" }, { id: "deleted" }] };
    await app.refresh.refresh();
    expect(app.config().providers.relay?.models.gone).toBeDefined();
    expect(app.config().providers.relay?.models.deleted).toBeUndefined();
  } finally {
    await app.refresh.dispose();
    fetcher.mockRestore();
  }
});

test("a temporary API match cannot erase protected manual edits across hourly refreshes", async () => {
  let context = 16000;
  const fetcher = mockFetch(async (input) =>
    Response.json(
      String(input) === "https://refresh.test/v1/models"
        ? { data: [{ id: "active", context_length: context, max_output_tokens: context }] }
        : {},
    ),
  );
  const app = await setup();
  try {
    const model = app.config().providers.relay?.models.active;
    if (!model) throw new Error("missing test model");
    model.context = 16000;
    await app.refresh.refresh();
    expect(app.config().providers.relay?.modelMetadataBaseline?.active?.context).toBe(8000);
    context = 64000;
    await app.refresh.refresh();
    expect(app.config().providers.relay?.models.active?.context).toBe(16000);
    expect(app.notifications()).toBe(app.commits());
    expect(app.notifications()).toBe(2);
  } finally {
    await app.refresh.dispose();
    fetcher.mockRestore();
  }
});

test("empty, failed and disposed refreshes leave saved models intact and redact diagnostics", async () => {
  let response = Response.json({ data: [] });
  const fetcher = mockFetch(async (input) =>
    String(input).startsWith("https://refresh.test") ? response.clone() : Response.json({}),
  );
  const app = await setup();
  try {
    const before = structuredClone(app.config().providers.relay?.models);
    await app.refresh.refresh();
    expect(app.commits()).toBe(0);
    expect(app.config().providers.relay?.models).toEqual(before);
    response = new Response("rejected refresh-secret", { status: 403 });
    await app.refresh.refresh();
    expect(app.commits()).toBe(0);
    await app.refresh.dispose();
    const diagnostics = await readFile(
      join(app.cwd, ".flecten", "diagnostics", "recent-errors.jsonl"),
      "utf8",
    );
    expect(diagnostics).toContain("provider_refresh_failed");
    expect(diagnostics).not.toContain("refresh-secret");
    const count = fetcher.mock.calls.length;
    await app.refresh.refresh();
    expect(fetcher.mock.calls).toHaveLength(count);
  } finally {
    await app.refresh.dispose();
    fetcher.mockRestore();
  }
});
