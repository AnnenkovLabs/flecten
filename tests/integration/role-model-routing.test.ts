import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { Event } from "../../src/core/types";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
interface Request {
  path: string;
  model: string;
  reasoning_effort?: string;
  marker?: string;
  max_tokens?: number;
  messages: Array<{ role: string; content: unknown }>;
}

async function fixture(conversation = true, custom = false) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-role-models-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const requests: Request[] = [];
  let delegate = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Request;
      requests.push({ ...body, path: new URL(request.url).pathname });
      let delta: unknown = {
        content:
          custom && !["main", "talker"].includes(body.model)
            ? '{"summary":"Sources checked."}'
            : body.model === "talker"
              ? "Working on the request."
              : "<summary>Completed.</summary>",
      };
      let finish_reason = "stop";
      if (delegate && ["main", "talker"].includes(body.model)) {
        delegate = false;
        delta = {
          tool_calls: [
            {
              index: 0,
              id: `delegate_${requests.length}`,
              type: "function",
              function: {
                name: custom ? "task" : "worker",
                arguments: JSON.stringify(
                  custom
                    ? { operation: "run", agent: "researcher", prompt: "Investigate the sources." }
                    : {
                        operation: "start",
                        task: "Investigate the sources and report the result.",
                      },
                ),
              },
            },
          ],
        };
        finish_reason = "tool_calls";
      }
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  cleanup.push(async () => server.stop(true));
  const agents = join(cwd, "agents");
  if (custom) {
    await mkdir(agents);
    await writeFile(
      join(agents, "researcher.json"),
      JSON.stringify({
        name: "researcher",
        description: "Investigates documents and sources.",
        provider: "roles",
        model: "definition",
        allowedTools: ["read"],
        permissions: [{ action: "read", policy: "allow" }],
        budget: { maxTurns: 4, maxTokens: 16000 },
        systemPrompt: "Investigate sources.",
      }),
    );
  }
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "primary",
      model: "main",
      reasoning: "medium",
      conversation: {
        enabled: conversation,
        talker: { provider: "primary", model: "talker", reasoning: "low" },
        worker: { provider: "roles", model: "worker", reasoning: "high", variant: "careful" },
      },
      subagents: {
        dirs: custom ? [agents] : [],
        models: custom
          ? {
              researcher: {
                provider: "roles",
                model: "child",
                reasoning: "low",
                variant: "careful",
              },
            }
          : {},
      },
      vision: { provider: "primary", model: "talker" },
      catalog: { autoRefresh: false },
      skills: { sources: [] },
      checkpoints: { shell: false },
      providers: {
        primary: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/main/v1`,
          models: {
            main: { context: 64000, output: 1024, vision: false, reasoning: true },
            talker: { context: 96000, output: 1024, vision: true, reasoning: true },
          },
        },
        roles: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/roles/v1`,
          models: Object.fromEntries(
            ["worker", "alternate", "child", "definition"].map((id) => [
              id,
              {
                context: 32000,
                output: 2048,
                vision: false,
                reasoning: true,
                reasoningMode: "effort",
                reasoningLevels: ["low", "high"],
                variants: { careful: { body: { marker: "careful" }, maxOutputTokens: 512 } },
              },
            ]),
          ),
        },
      },
    }),
  );
  let app = await createAppService(cwd);
  cleanup.push(() => app.dispose());
  const events: Event[] = [];
  app.session.subscribe((event) => events.push(event));
  return {
    requests,
    events,
    get app() {
      return app;
    },
    delegate: () => {
      delegate = true;
    },
    async run(id: string) {
      await app.session.send({ type: "run", sessionId: id, prompt: "Investigate the sources." });
      await app.session.flush();
    },
    async restart() {
      await app.dispose();
      app = await createAppService(cwd);
      app.session.subscribe((event) => events.push(event));
    },
  };
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Role execution did not finish");
    await Bun.sleep(5);
  }
}

test("Talker and Worker use independent transports and restored composer choices stay with Worker", async () => {
  const h = await fixture();
  expect(h.app.info()).toMatchObject({
    provider: "roles",
    model: "worker",
    reasoning: "high",
    variant: "careful",
    contextWindow: 32000,
  });
  h.delegate();
  await h.run("dual_roles");
  await until(() => h.requests.some((request) => request.model === "worker"));
  expect(h.requests.find((request) => request.model === "worker")).toMatchObject({
    path: "/roles/v1/chat/completions",
    reasoning_effort: "high",
    marker: "careful",
    max_tokens: 512,
  });
  expect(h.requests.find((request) => request.model === "talker")).toMatchObject({
    path: "/main/v1/chat/completions",
    reasoning_effort: "low",
  });
  await h.app.session.send({ type: "stop", sessionId: "dual_roles" });
  await h.restart();
  await h.run("dual_roles");
  expect(h.app.info("dual_roles").model).toBe("worker");
  expect(h.requests.at(-1)).toMatchObject({ model: "talker", reasoning_effort: "low" });
  await h.app.setModel({
    sessionId: "dual_roles",
    provider: "roles",
    model: "alternate",
    reasoning: "low",
  });
  const config = h.app.settings().config;
  await h.app.saveSettings({
    config: { ...config, conversation: { ...config.conversation, enabled: false } },
  });
  await h.restart();
  expect(h.app.info().model).toBe("main");
  h.delegate();
  await h.run("dual_roles");
  await until(() => h.requests.some((request) => request.model === "alternate"));
  expect(h.requests.find((request) => request.model === "alternate")).toMatchObject({
    reasoning_effort: "low",
    path: "/roles/v1/chat/completions",
  });
  expect(h.app.info("dual_roles").model).toBe("alternate");
  await h.app.session.send({ type: "stop", sessionId: "dual_roles" });
  await h.run("new_single");
  expect(h.requests.at(-1)).toMatchObject({ model: "main", reasoning_effort: "medium" });
}, 10000);

test("discovered subagent settings override definition models and keep variant and reasoning", async () => {
  const h = await fixture(false, true);
  expect(h.app.settings().subagentRoles).toContainEqual({
    id: "researcher",
    name: "researcher",
    description: "Investigates documents and sources.",
  });
  h.delegate();
  await h.run("subagent_roles");
  expect(h.requests.find((request) => request.model === "child")).toMatchObject({
    path: "/roles/v1/chat/completions",
    reasoning_effort: "low",
    marker: "careful",
    max_tokens: 512,
  });
  const config = h.app.settings().config;
  await h.app.saveSettings({
    config: { ...config, subagents: { ...config.subagents, models: {} } },
  });
  h.delegate();
  await h.run("subagent_roles");
  expect(h.requests.find((request) => request.model === "definition")?.path).toBe(
    "/roles/v1/chat/completions",
  );
});

test("role model settings reject disabled, unavailable and tool-less selections", async () => {
  const h = await fixture();
  const config = h.app.settings().config;
  for (const model of ["missing", "disabled", "plain"]) {
    const candidate = {
      ...config,
      providers: {
        ...config.providers,
        roles: {
          ...config.providers.roles,
          models: {
            ...config.providers.roles?.models,
            disabled: { disabled: true },
            plain: { tools: false },
          },
        },
      },
      conversation: { ...config.conversation, worker: { provider: "roles", model } },
    };
    expect(HarnessConfigSchema.safeParse(candidate).success).toBe(false);
  }
});
