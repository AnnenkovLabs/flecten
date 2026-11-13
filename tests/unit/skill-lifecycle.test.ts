import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { ProviderConfigSchema } from "../../src/config/schema";
import type { Event, RunResult } from "../../src/core/types";

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function streamed(content: unknown) {
  return new Response(`data: ${JSON.stringify(content)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}
function calls(items: Array<{ name: string; args: unknown }>) {
  return streamed({
    choices: [
      {
        delta: {
          tool_calls: items.map(({ name, args }, index) => ({
            index,
            id: `call-${index}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
  });
}

test("a real parallel model batch installs skill restrictions before shell execution and preserves them across reload", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-skill-lifecycle-"));
  dirs.push(cwd);
  const directory = join(cwd, ".liquid/skills/reader");
  await mkdir(directory, { recursive: true });
  await Bun.write(
    join(directory, "SKILL.md"),
    "---\nname: reader\ndescription: Read source\nallowed-tools: read grep\n---\nRead files only.",
  );
  let turn = 0;
  let scenario: "activate" | "continue" | "untrusted" = "activate";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json();
      turn += 1;
      if (turn % 2 === 0)
        return streamed({
          choices: [{ delta: { content: "<summary>Finished.</summary>" }, finish_reason: "stop" }],
        });
      if (scenario === "activate")
        return calls([
          { name: "skill", args: { name: "reader" } },
          { name: "bash", args: { command: "touch forbidden" } },
        ]);
      if (scenario === "continue")
        return calls([{ name: "bash", args: { command: "touch forbidden" } }]);
      return calls([{ name: "skill", args: { name: "reader" } }]);
    },
  });
  servers.push(server);
  const config = defaultConfig();
  config.conversation = { enabled: false };
  config.provider = "local";
  config.model = "test";
  config.providers = {
    local: ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: server.url.href,
      models: { test: { context: 65536, output: 1024, tools: true, reasoning: false } },
    }),
  };
  config.skills = { sources: ["project-liquid"] };
  config.catalog.autoRefresh = false;
  config.loop.parallelTools = true;
  config.sandbox = { ...config.sandbox, enabled: false } as typeof config.sandbox;
  config.permissions = { ...config.permissions, shell: "allow" } as typeof config.permissions;
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  const first = await createAppService(cwd);
  let sessionId = "";
  try {
    await first.acceptTrust();
    const events: Event[] = [];
    first.session.subscribe((event) => events.push(event));
    const result = (await first.session.send({
      type: "run",
      prompt: "Use the reader skill",
    })) as RunResult;
    sessionId = result.sessionId;
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    const finished = events.filter((event) => event.type === "tool.finished");
    expect(finished[0]).toMatchObject({ call: { name: "skill" }, result: { ok: true } });
    expect(finished[1]).toMatchObject({
      call: { name: "bash" },
      result: { ok: false, data: { kind: "permission" } },
    });
    expect(await Bun.file(join(cwd, "forbidden")).exists()).toBe(false);
    const draft = first.settings().config;
    draft.skills = { ...draft.skills, sources: ["project-liquid"], trust: { reader: "untrusted" } };
    await first.saveSettings({ config: draft });
    expect(await first.extensions.skills()).toMatchObject([{ name: "reader", trust: "untrusted" }]);
  } finally {
    await first.dispose();
  }

  const reopened = await createAppService(cwd);
  try {
    await reopened.acceptTrust();
    expect(reopened.settings().config.skills?.trust?.reader).toBe("untrusted");
    const events: Event[] = [];
    reopened.session.subscribe((event) => events.push(event));
    scenario = "continue";
    turn = 0;
    await reopened.session.send({ type: "run", sessionId, prompt: "Continue" });
    expect(
      events.find((event) => event.type === "tool.finished" && event.call.name === "bash"),
    ).toMatchObject({ result: { ok: false, data: { kind: "permission" } } });
    expect(await Bun.file(join(cwd, "forbidden")).exists()).toBe(false);
    scenario = "untrusted";
    turn = 0;
    events.length = 0;
    await reopened.session.send({ type: "run", prompt: "Use reader" });
    expect(events.find((event) => event.type === "tool.finished")).toMatchObject({
      call: { name: "skill" },
      result: { ok: false, output: "", data: { kind: "permission" } },
    });
  } finally {
    await reopened.dispose();
  }
});
