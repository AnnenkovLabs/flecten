import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import { HarnessConfigSchema } from "../../src/config/schema";

test("saving an older settings draft keeps hourly metadata and applies only its model edits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-refresh-settings-"));
  const models = {
    active: { name: "Active", context: 8000, output: 1000, tools: true },
    gone: { name: "Gone" },
    deleted: { name: "Deleted" },
  };
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "relay",
    model: "active",
    catalog: { autoRefresh: false },
    providers: {
      relay: {
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:1/v1",
        models,
        modelMetadataBaseline: models,
        modelAutoRefresh: { enabled: true },
      },
    },
  });
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  const app = await createAppService(cwd);
  try {
    const baseline = app.settings().config;
    const draft = structuredClone(baseline);
    const fresh = structuredClone(baseline);
    const provider = fresh.providers.relay;
    const edited = draft.providers.relay;
    if (!provider || !edited?.models.active) throw new Error("missing test provider");
    provider.models = {
      active: { ...models.active, context: 64000 },
      deleted: models.deleted,
      added: { context: 32000 },
    };
    provider.modelMetadataBaseline = structuredClone(provider.models);
    await app.saveSettings({ config: fresh });
    edited.models.active.name = "My active model";
    delete edited.models.deleted;
    edited.models.local = { name: "Local model" };
    edited.modelAutoRefresh = { enabled: true, overwriteManual: true };
    const handlers = createHandlers(app, () => undefined);
    await handlers["settings.save"]({ type: "settings.save", config: draft, baseline });
    const saved = app.settings().config.providers.relay;
    expect(saved?.models).toEqual({
      active: { ...models.active, name: "My active model", context: 64000 },
      added: { context: 32000 },
      local: { name: "Local model" },
    });
    expect(saved?.modelMetadataBaseline).toEqual(provider.modelMetadataBaseline);
    expect(saved?.modelAutoRefresh?.overwriteManual).toBe(true);
    await expect(app.saveSettings({ config: draft, baseline: null })).rejects.toThrow();
  } finally {
    await app.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
