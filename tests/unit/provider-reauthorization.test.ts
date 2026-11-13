import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import { HarnessConfigSchema } from "../../src/config/schema";
import { createProvider, invalidateProviderAuthorization } from "../../src/providers/registry";
import { collect, request } from "../helpers/provider-adapters";

test("reauthorization refreshes the command token and the already-created provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-auth-refresh-"));
  const tokenPath = join(cwd, "credential.txt");
  const headers: string[] = [];
  const id = `refresh-${crypto.randomUUID()}`;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      headers.push(req.headers.get("authorization") ?? "");
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    },
  });
  let app: Awaited<ReturnType<typeof createAppService>> | undefined;
  try {
    await writeFile(tokenPath, "first-credential");
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: id,
      model: "test-model",
      catalog: { autoRefresh: false },
      providers: {
        [id]: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: { "test-model": {} },
          auth: {
            command: process.execPath,
            args: ["-e", "process.stdout.write(await Bun.file(process.argv[1]).text())", tokenPath],
            refreshIntervalMs: 3_600_000,
          },
        },
      },
    });
    await writeFile(join(cwd, "flecten.config.json"), JSON.stringify(config));
    app = await createAppService(cwd);
    const active = createProvider(config);
    await collect(active.provider.stream(request(), new AbortController().signal));
    expect(headers.at(-1)).toBe("Bearer first-credential");
    await writeFile(tokenPath, "second-credential");
    await collect(active.provider.stream(request(), new AbortController().signal));
    expect(headers.at(-1)).toBe("Bearer first-credential");
    const handlers = createHandlers(app, () => undefined);
    const result = await handlers["provider.reauthorize"]({
      type: "provider.reauthorize",
      id,
      model: "test-model",
    });
    expect(result).toMatchObject({ result: { ok: true } });
    expect(headers.at(-1)).toBe("Bearer second-credential");
    await collect(active.provider.stream(request(), new AbortController().signal));
    expect(headers.at(-1)).toBe("Bearer second-credential");
    expect(JSON.stringify(app.settings())).not.toContain("second-credential");
    await expect(
      handlers["provider.reauthorize"]({ type: "provider.reauthorize", id, model: "unknown" }),
    ).rejects.toThrow("Unknown provider or model");
  } finally {
    await app?.dispose();
    invalidateProviderAuthorization(id);
    server.stop(true);
    await rm(cwd, { recursive: true, force: true });
  }
});
