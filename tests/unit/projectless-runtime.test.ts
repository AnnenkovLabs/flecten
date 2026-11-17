import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { ShellSnapshots } from "../../src/app/shell-checkpoints";
import { defaultConfig } from "../../src/config/defaults";
import { PermissionsConfigSchema, ProviderConfigSchema } from "../../src/config/schema";
import { buildPrompt } from "../../src/core/prompt";
import { discoverSkills } from "../../src/skills/discover";
import { CheckpointStore } from "../../src/store/checkpoints";
import { scriptedProvider } from "../helpers/fake-provider";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "flecten-projectless-"));
  directories.push(path);
  return path;
}

test("projectless model context keeps global instructions and excludes cwd and nested instructions for every role", async () => {
  const cwd = await directory();
  const user = join(cwd, "global-instructions.md");
  await writeFile(user, "GLOBAL_USER_RULE");
  await writeFile(join(cwd, "AGENTS.md"), "UNSELECTED_ROOT_RULE");
  await writeFile(join(cwd, "AGENTS.local.md"), "UNSELECTED_LOCAL_RULE");
  await mkdir(join(cwd, "other-project"));
  await writeFile(join(cwd, "other-project/AGENTS.md"), "UNSELECTED_NESTED_RULE");
  for (const role of [undefined, "talker", "worker"] as const) {
    const prompt = await buildPrompt(cwd, {
      projectRoot: null,
      ...(role ? { role } : {}),
      instructions: { managed: [], user: [user], nested: true },
    });
    expect(prompt.instructions.sources.map((source) => source.kind)).toEqual(["user"]);
    expect(prompt.system).toContain("GLOBAL_USER_RULE");
    expect(prompt.system).toContain("No project folder is selected");
    expect(prompt.system).not.toContain("UNSELECTED_");
  }
  const project = await buildPrompt(cwd, { instructions: { managed: [], user: [] } });
  expect(project.system).toContain("UNSELECTED_ROOT_RULE");
  expect(project.system).not.toContain("UNSELECTED_NESTED_RULE");
});

test("projectless skill discovery cannot load project sources even when explicitly enabled", async () => {
  const cwd = await directory();
  const home = await directory();
  for (const [root, name] of [
    [cwd, "project-only"],
    [home, "user-only"],
  ] as const) {
    const skill = join(root, ".agents/skills", name);
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      `---\nname: ${name}\ndescription: Test skill\n---\nTest`,
    );
  }
  const skills = await discoverSkills(cwd, {
    projectRoot: null,
    home,
    sources: ["project-agents", "user-agents"],
  });
  expect(skills.skills.map((skill) => skill.name)).toEqual(["user-only"]);
});

test("projectless mode never starts shadow git indexing even when shell snapshots are enabled", async () => {
  const cwd = await directory();
  const config = defaultConfig();
  const snapshots = new ShellSnapshots(cwd, new CheckpointStore({ cwd }), false);
  snapshots.configure(config);
  expect(snapshots.service).toBeUndefined();
  expect(snapshots.state.state).toBe("off");
  await snapshots.settled();
  expect(await Bun.file(join(cwd, ".flecten/shadow/HEAD")).exists()).toBe(false);
});

test("the real service runs outside-file tools without treating the file's parent as a project", async () => {
  const profile = await directory();
  const cwd = join(profile, "projectless");
  const external = await directory();
  await mkdir(cwd);
  await writeFile(join(external, "AGENTS.md"), "OUTSIDE_PROJECT_INSTRUCTION");
  await writeFile(join(external, "note.txt"), "TASK_FILE_CONTENT");
  const config = defaultConfig();
  config.useDefaults = false;
  config.provider = "test";
  config.model = "test";
  config.providers = {
    test: ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:1",
      models: { test: { context: 200_000, output: 8_192, reasoning: false } },
    }),
  };
  config.catalog.autoRefresh = false;
  config.conversation = { enabled: false };
  config.skills = { sources: [] };
  config.permissions = PermissionsConfigSchema.parse({ externalPath: "allow" });
  const path = join(profile, "config.json");
  await writeFile(path, JSON.stringify(config));
  const prior = process.env.FLECTEN_CONFIG;
  process.env.FLECTEN_CONFIG = path;
  const app = await createAppService(cwd, null);
  try {
    expect(app.info()).toMatchObject({
      projectRoot: null,
      project: "",
      branch: "",
      trustRequired: false,
    });
    expect(app.info().shellCheckpoints.state).toBe("off");
    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          id: "outside-read",
          name: "read",
          args: { path: join(external, "note.txt") },
        },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "<complete>Read the requested file.</complete>" },
        { type: "done", reason: "end" },
      ],
    ]);
    await app.session.send({ type: "status" });
    app.session.update({ provider });
    const result = await app.session.send({
      type: "run",
      prompt: `Read ${join(external, "note.txt")}`,
    });
    expect(result).toMatchObject({ stopReason: "done" });
    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain("TASK_FILE_CONTENT");
    expect(provider.requests[0]?.system).not.toContain("OUTSIDE_PROJECT_INSTRUCTION");
    expect((await app.listSessions()).length).toBe(1);
    expect(await Bun.file(join(external, ".flecten/sessions/index.json")).exists()).toBe(false);
    expect(await Bun.file(join(cwd, ".flecten/shadow/HEAD")).exists()).toBe(false);
  } finally {
    await app.dispose();
    if (prior === undefined) delete process.env.FLECTEN_CONFIG;
    else process.env.FLECTEN_CONFIG = prior;
  }
});
