import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import type { HarnessConfig } from "../../src/config/schema";
import type { RunResult } from "../../src/core/types";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(conversation = false) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-session-model-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const requests: Array<{
    path: string;
    model: string;
    reasoning_effort?: string;
    variant_marker?: string;
    max_tokens?: number;
  }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as (typeof requests)[number];
      requests.push({ ...body, path: new URL(request.url).pathname });
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  cleanup.push(async () => server.stop(true));
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      conversation: { enabled: conversation },
      provider: "test",
      model: "default-model",
      catalog: { autoRefresh: false },
      skills: { sources: [] },
      checkpoints: { shell: false },
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: {
            "default-model": { context: 128000, output: 1024, reasoning: false },
            "chat-model": { context: 64000, output: 2048, reasoning: false },
          },
        },
        other: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/other/v1`,
          models: {
            "other-model": {
              context: 32000,
              output: 2048,
              reasoning: true,
              reasoningMode: "effort",
              reasoningLevels: ["low", "high"],
              variants: { careful: { body: { variant_marker: "careful" }, maxOutputTokens: 512 } },
            },
          },
        },
      },
    }),
  );
  let app = await createAppService(cwd);
  cleanup.push(() => app.dispose());
  const run = async (sessionId?: string) => {
    const result = (await app.session.send({
      type: "run",
      prompt: "Reply briefly.",
      ...(sessionId ? { sessionId } : {}),
    })) as RunResult;
    expect(result.stopReason).toBe("end");
    await app.session.flush();
    return result.sessionId;
  };
  return {
    get app() {
      return app;
    },
    run,
    requests,
    async restart() {
      await app.dispose();
      app = await createAppService(cwd);
    },
  };
}

test("a composer model choice belongs to one chat and survives reopening the app", async () => {
  const h = await fixture();
  const { app, run, requests } = h;
  const first = await run();
  const second = await run();
  await createHandlers(app, () => {})["model.set"]({
    type: "model.set",
    sessionId: first,
    provider: "test",
    model: "chat-model",
  });
  expect(app.settings().config.model).toBe("default-model");
  await run(first);
  await run(second);
  expect(requests.map((request) => request.model)).toEqual([
    "default-model",
    "default-model",
    "chat-model",
    "default-model",
  ]);
  await h.restart();
  await run(first);
  await run(second);
  expect(requests.slice(-2).map((request) => request.model)).toEqual([
    "chat-model",
    "default-model",
  ]);
});

test("chat provider, reasoning and variant reach the transport while global defaults stay separate", async () => {
  const h = await fixture();
  const first = await h.run();
  const second = await h.run();
  const handlers = createHandlers(h.app, () => {});
  const selected = await handlers["model.set"]({
    type: "model.set",
    sessionId: first,
    provider: "other",
    model: "other-model",
    reasoning: "high",
    variant: "careful",
  });
  expect(selected?.info).toMatchObject({
    sessionId: first,
    provider: "other",
    model: "other-model",
    reasoning: "high",
    variant: "careful",
    contextWindow: 32000,
  });
  const config = h.app.settings().config;
  await h.app.saveSettings({ config: { ...config, maxOutputTokens: 900 } satisfies HarnessConfig });
  await Promise.all([h.run(first), h.run(second)]);
  expect(h.requests.findLast((request) => request.model === "other-model")).toMatchObject({
    path: "/other/v1/chat/completions",
    reasoning_effort: "high",
    variant_marker: "careful",
    max_tokens: 512,
  });
  await handlers["model.set"]({ type: "model.set", provider: "test", model: "chat-model" });
  expect(h.app.info()).toMatchObject({ provider: "test", model: "chat-model" });
  expect(h.app.info().sessionId).toBeUndefined();
  const scoped = await handlers.status({ type: "status", sessionId: first });
  expect(scoped?.info).toMatchObject({ sessionId: first, provider: "other", model: "other-model" });
  await h.run(second);
  expect(h.requests.at(-1)?.model).toBe("default-model");
  await h.run();
  expect(h.requests.at(-1)?.model).toBe("chat-model");
  await h.restart();
  const restored = await createHandlers(h.app, () => {}).status({
    type: "status",
    sessionId: first,
  });
  expect(restored?.info).toMatchObject({ sessionId: first, reasoning: "high", variant: "careful" });
  await h.run(first);
  expect(h.requests.at(-1)).toMatchObject({
    model: "other-model",
    path: "/other/v1/chat/completions",
    variant_marker: "careful",
  });
});

test("a new chat's saved choice works before its first run and rapid choices keep their order", async () => {
  const h = await fixture();
  const handlers = createHandlers(h.app, () => {});
  const selected: string[] = [];
  h.app.session.subscribe((event) => {
    if (event.type === "model.selected") selected.push(event.model);
  });
  await Promise.all([
    handlers["model.set"]({
      type: "model.set",
      sessionId: "draft_chat",
      provider: "test",
      model: "chat-model",
    }),
    handlers["model.set"]({
      type: "model.set",
      sessionId: "draft_chat",
      provider: "other",
      model: "other-model",
      reasoning: "low",
    }),
  ]);
  expect(selected).toEqual(["chat-model", "other-model"]);
  expect(h.app.settings().config.model).toBe("default-model");
  await h.restart();
  await h.run("draft_chat");
  expect(h.requests.at(-1)).toMatchObject({
    model: "other-model",
    reasoning_effort: "low",
    path: "/other/v1/chat/completions",
  });
  await expect(
    createHandlers(h.app, () => {})["model.set"]({
      type: "model.set",
      sessionId: "../escape",
      provider: "test",
      model: "chat-model",
    }),
  ).rejects.toThrow("sessionId is invalid");
  await expect(
    h.app.setModel({ sessionId: "draft_chat", provider: "test", model: "missing" }),
  ).rejects.toThrow("unknown model");
});

test("a restored conversation keeps the chosen chat model for its Talker", async () => {
  const h = await fixture(true);
  const first = "new_conversation";
  await h.app.setModel({
    sessionId: first,
    provider: "other",
    model: "other-model",
    reasoning: "high",
  });
  await h.run(first);
  expect(
    (await h.app.readSession(first)).find((event) => event.type === "session.started"),
  ).toMatchObject({ role: "talker" });
  expect(h.requests.at(-1)).toMatchObject({
    model: "other-model",
    path: "/other/v1/chat/completions",
  });
  await h.restart();
  await h.run(first);
  expect(h.requests.at(-1)).toMatchObject({
    model: "other-model",
    path: "/other/v1/chat/completions",
  });
});
