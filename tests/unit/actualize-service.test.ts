import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { setSecretBackend } from "../../src/config/secrets";

const dirs: string[] = [];
const servers: Array<{ stop(force?: boolean): void }> = [];

beforeEach(() => {
  setSecretBackend("file");
  delete process.env.FLECTEN_CONFIG;
  delete process.env.FLECTEN_PROVIDER;
  delete process.env.FLECTEN_MODEL;
});

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function modelsServer(ids: string[]): string {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: ids.map((id) => ({ id, object: "model", context_length: 64_000 })),
        });
      }
      return Response.json({ error: { message: "probe disabled in this test" } }, { status: 400 });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/v1`;
}

describe("provider actualize through the app service", () => {
  test("keeps user overrides, reports the diff and never drops the active model silently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "liquid-actualize-"));
    dirs.push(dir);
    const baseUrl = modelsServer(["kept-model", "new-model"]);
    await writeFile(
      join(dir, "flecten.config.json"),
      JSON.stringify({
        useDefaults: false,
        provider: "local",
        model: "active-gone",
        providers: {
          local: {
            protocol: "openai-chat",
            baseUrl,
            apiKey: "sk-local-test",
            models: {
              "kept-model": { name: "My renamed model", context: 8_000 },
              "active-gone": { name: "Active model" },
              "stale-model": { name: "Stale" },
            },
          },
        },
      }),
    );
    const service = await createAppService(dir);
    try {
      const result = await service.actualizeProvider("local");

      expect(result.added).toEqual(["new-model"]);
      expect(result.removed).toEqual(["stale-model"]);
      expect(result.updated).toEqual(["kept-model"]);
      expect(result.warnings.some((line) => line.includes("active-gone"))).toBe(true);

      const saved = JSON.parse(await readFile(join(dir, "flecten.config.json"), "utf8"));
      const models = saved.providers.local.models;
      expect(saved.model).toBe("active-gone");
      expect(models["kept-model"].name).toBe("My renamed model");
      expect(models["kept-model"].context).toBe(64_000);
      expect(models["active-gone"].name).toBe("Active model");
      expect(models["stale-model"]).toBeUndefined();
      expect(models["new-model"]).toBeDefined();
    } finally {
      await service.dispose();
    }
  });
});
