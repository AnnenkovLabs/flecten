import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_SOURCES } from "../../src/config/skills";
import { listSkillCommands, renderSkillCatalog } from "../../src/skills/catalog";
import { discoverSkills, skillScopes } from "../../src/skills/discover";
import { skillToolPolicy } from "../../src/skills/policy";
import { readSkillResource } from "../../src/skills/resource";
import { listSkillResources } from "../../src/skills/resources";
import type { Skill } from "../../src/skills/schema";
import { createSkillTool, type SkillActivationData } from "../../src/skills/tool";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

interface WriteSkillOptions {
  frontmatter?: string;
  body?: string;
  resources?: Record<string, string>;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-skills-"));
  dirs.push(dir);
  return dir;
}

async function writeSkill(
  root: string,
  scope: string,
  name: string,
  description: string,
  options: WriteSkillOptions = {},
): Promise<string> {
  const directory = join(root, scope, name);
  await mkdir(join(directory, "references"), { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n${options.frontmatter ?? ""}---\n\n${
      options.body ?? `# ${name}\n\nDo the thing.\n`
    }`,
  );
  await writeFile(join(directory, "references", "guide.md"), "guide\n");
  for (const [path, content] of Object.entries(options.resources ?? {})) {
    const target = join(directory, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

function context(cwd: string, sessionId = "s_test"): ToolContext {
  return {
    sessionId,
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits,
    reads: new ReadTracker(),
  };
}

function skillTool(skills: Skill[]): ToolRegistry {
  const tool = createSkillTool(skills);
  if (!tool) throw new Error("skill tool was not created");
  return new ToolRegistry([tool], { limits });
}

function activation(result: { data?: unknown }): SkillActivationData {
  return result.data as SkillActivationData;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skills", () => {
  test("loads only selected scopes, keeping precedence independent of selection order", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    const scopes = skillScopes(cwd, home);
    expect(scopes.map((scope) => scope.id)).toEqual([...SKILL_SOURCES]);
    for (const scope of scopes) {
      await writeSkill(scope.directory, "", "review", scope.id);
    }
    for (const scope of scopes) {
      const result = await discoverSkills(cwd, { home, sources: [scope.id] });
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.description).toBe(scope.id);
      expect(result.diagnostics).toEqual([]);
    }
    const onlyAgents = await discoverSkills(cwd, { home, sources: ["user-agents"] });
    expect(onlyAgents.skills[0]?.location).toBe(join(home, ".agents/skills/review/SKILL.md"));
    const ordered = await discoverSkills(cwd, { home, sources: [...SKILL_SOURCES].reverse() });
    expect(ordered.skills[0]?.description).toBe("project-liquid");
    expect(await discoverSkills(cwd, { home, sources: [] })).toEqual({
      skills: [],
      diagnostics: [],
    });
  });

  test("discovers project skills and lets project override user", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(home, ".agents/skills", "review", "User review");
    await writeSkill(cwd, ".agents/skills", "review", "Project review");
    await writeSkill(cwd, ".liquid/skills", "release", "Release safety");

    const result = await discoverSkills(cwd, { home });
    expect(result.skills.map((skill) => skill.name)).toEqual(["release", "review"]);
    expect(result.skills.find((skill) => skill.name === "review")?.description).toBe(
      "Project review",
    );
    expect(result.diagnostics.some((entry) => entry.message.includes("overrides"))).toBe(true);
  });

  test("skips broken frontmatter and recovers colon-heavy descriptions", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "good", "Good skill");
    const bad = join(cwd, ".agents/skills", "bad");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "SKILL.md"), "# no frontmatter\n");
    const loose = join(cwd, ".agents/skills", "loose");
    await mkdir(loose, { recursive: true });
    await writeFile(
      join(loose, "SKILL.md"),
      "---\nname: loose\ndescription: Use when: the task mentions a strict format\n---\n\nLoose body.\n",
    );

    const result = await discoverSkills(cwd, { home });
    expect(result.skills.map((skill) => skill.name)).toEqual(["good", "loose"]);
    expect(result.skills[1]?.description).toContain("Use when: the task");
    expect(result.diagnostics.some((entry) => entry.level === "error")).toBe(true);
    expect(result.diagnostics.some((entry) => entry.message.includes("lenient fallback"))).toBe(
      true,
    );
  });

  test("activation returns instructions without frontmatter and lists resources", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "review", "Review code");
    const discovery = await discoverSkills(cwd, { home });
    const result = await skillTool(discovery.skills).run(
      { id: "skill-1", name: "skill", args: { name: "review" } },
      context(cwd),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("# Skill instructions\n\n- Name: `review`");
    expect(result.output).toContain("Do the thing.");
    expect(result.output).not.toContain("description: Review code");
    expect(result.output).toContain("references/guide.md");
  });

  test("dedupes unchanged activation per session and reloads edited instructions", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    const directory = await writeSkill(cwd, ".agents/skills", "review", "Review code");
    const discovery = await discoverSkills(cwd, { home });
    const registry = skillTool(discovery.skills);
    const first = await registry.run(
      { id: "skill-1", name: "skill", args: { name: "review" } },
      context(cwd),
    );
    expect(first.ok).toBe(true);
    const firstData = activation(first);

    await writeFile(
      join(directory, "SKILL.md"),
      "---\nname: review\ndescription: Changed\n---\n\nChanged body.\n",
    );
    await writeFile(join(directory, "references", "new.md"), "new\n");

    const second = await registry.run(
      { id: "skill-2", name: "skill", args: { name: "review" } },
      context(cwd),
    );
    expect(second.ok).toBe(true);
    expect(second.output).toContain("Changed body.");
    expect(activation(second).reused).toBe(false);
    expect(activation(second).resources).not.toEqual(firstData.resources);
    expect(activation(second).resources).toContain("references/new.md");
    const repeated = await registry.run(
      { id: "skill-repeat", name: "skill", args: { name: "review" } },
      context(cwd),
    );
    expect(activation(repeated).reused).toBe(true);

    const otherSession = await registry.run(
      { id: "skill-3", name: "skill", args: { name: "review" } },
      context(cwd, "s_other"),
    );
    expect(otherSession.output).toContain("Changed body.");
    expect(activation(otherSession).reused).toBe(false);
  });

  test("exposes slash command metadata and version without the body", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "release", "Release safety", {
      frontmatter:
        'version: 2.1.0\nargument-hint: "[target]"\nallowed-tools: read grep\nmetadata:\n  version: "9.9.9"\n',
    });
    await writeSkill(home, ".agents/skills", "global", "Global helper");

    const discovery = await discoverSkills(cwd, { home, trust: { release: "untrusted" } });
    const release = discovery.skills.find((skill) => skill.name === "release");
    expect(release?.version).toBe("2.1.0");
    expect(release?.argumentHint).toBe("[target]");
    expect(release?.allowedTools).toEqual(["read", "grep"]);
    expect(release?.source).toBe("project");
    expect(release?.trust).toBe("untrusted");
    expect(discovery.skills.find((skill) => skill.name === "global")?.source).toBe("user");

    const commands = listSkillCommands(discovery.skills);
    expect(commands.find((command) => command.name === "release")).toEqual({
      name: "release",
      description: "Release safety",
      source: "project",
      trust: "untrusted",
      allowedTools: ["read", "grep"],
      argumentHint: "[target]",
      version: "2.1.0",
    });
    expect(commands.find((command) => command.name === "release")?.description).not.toContain(
      "Do the thing.",
    );
  });

  test("reads version from metadata when the top-level field is absent", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "persona", "Persona", {
      frontmatter: 'metadata:\n  version: "3.0.0"\n',
    });
    const discovery = await discoverSkills(cwd, { home });
    expect(discovery.skills[0]?.version).toBe("3.0.0");
  });

  test("untrusted skills cannot load executable instructions", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "gated", "Gated skill", {
      frontmatter: "allowed-tools: read grep\n",
    });
    const discovery = await discoverSkills(cwd, { home, trust: { gated: "untrusted" } });
    const gated = discovery.skills[0];
    if (!gated) throw new Error("gated skill was not discovered");

    const result = await skillTool(discovery.skills).run(
      { id: "skill-1", name: "skill", args: { name: "gated" } },
      context(cwd),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toBe("");
    expect(result.error).toContain("not trusted");
  });

  test("enforces an activated allowlist through the real tool registry without granting other permissions", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    await writeSkill(cwd, ".agents/skills", "reader", "Read only", {
      frontmatter: "allowed-tools: read grep\n",
    });
    const discovery = await discoverSkills(cwd, { home });
    const activations = new Map();
    const skill = createSkillTool(discovery.skills, activations);
    if (!skill) throw new Error("missing skill");
    const { builtinTools } = await import("../../src/tools/builtin");
    const registry = new ToolRegistry([...builtinTools(), skill], {
      limits,
      authorize: skillToolPolicy(activations),
    });
    await Bun.write(join(cwd, "source.txt"), "source");
    const activated = await registry.run(
      { id: "activate", name: "skill", args: { name: "reader" } },
      context(cwd),
    );
    expect(activated.ok).toBe(true);
    const denied = await registry.run(
      { id: "write", name: "bash", args: { command: "touch forbidden" } },
      context(cwd),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('does not allow tool "bash"');
    expect(await Bun.file(join(cwd, "forbidden")).exists()).toBe(false);
    expect(
      (await registry.run({ id: "read", name: "read", args: { path: "source.txt" } }, context(cwd)))
        .ok,
    ).toBe(true);
    const next = new ToolRegistry(
      [
        ...builtinTools(),
        createSkillTool(discovery.skills, activations) as NonNullable<typeof skill>,
      ],
      { limits, authorize: skillToolPolicy(activations) },
    );
    expect(
      (await next.run({ id: "again", name: "skill", args: { name: "reader" } }, context(cwd))).data,
    ).toMatchObject({ reused: true });
    expect(
      (
        await next.run(
          { id: "denied-again", name: "bash", args: { command: "touch forbidden" } },
          context(cwd),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await next.run(
          { id: "other-session", name: "bash", args: { command: "printf allowed" } },
          context(cwd, "another"),
        )
      ).ok,
    ).toBe(true);
  });

  test("lists skill resources without exposing their contents", async () => {
    const cwd = await tempDir();
    const directory = await writeSkill(cwd, ".agents/skills", "research", "Research", {
      resources: {
        "scripts/run.ts": "throw new Error('must not run');\n",
        "references/nested/deep.md": "secret body\n",
      },
    });
    const files = await listSkillResources(directory);
    expect(files).toEqual(["references/guide.md", "references/nested/deep.md", "scripts/run.ts"]);
    expect(files.join("\n")).not.toContain("secret body");
    expect(files.join("\n")).not.toContain("must not run");
  });

  test("previews only advertised contained text resources without executing them", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    const directory = await writeSkill(cwd, ".agents/skills", "reader", "Reader", {
      resources: {
        "scripts/run.ts": "throw new Error('must not execute')",
        "references/binary": "abc\0def",
      },
    });
    const skill = (await discoverSkills(cwd, { home })).skills[0];
    if (!skill) throw new Error("missing skill");
    const preview = await readSkillResource(skill, "scripts/run.ts");
    expect(preview.text).toContain("must not execute");
    expect(preview.truncated).toBe(false);
    await expect(readSkillResource(skill, "../../flecten.config.json")).rejects.toThrow(
      "списка ресурсов",
    );
    await expect(readSkillResource(skill, "references/binary")).rejects.toThrow("Бинарный");
    const { symlink } = await import("node:fs/promises");
    await Bun.write(join(cwd, "outside"), "secret");
    await symlink(join(cwd, "outside"), join(directory, "references/linked"));
    await expect(readSkillResource(skill, "references/linked")).rejects.toThrow("списка ресурсов");
  });

  test("omits the skill tool when no skills are installed", () => {
    expect(createSkillTool([])).toBeUndefined();
  });

  test("keeps the catalog bounded and reports omitted skills", () => {
    const skills: Skill[] = Array.from({ length: 30 }, (_, index) => ({
      name: `skill-${index}`,
      description: "x".repeat(2000),
      location: `/tmp/skill-${index}/SKILL.md`,
      directory: `/tmp/skill-${index}`,
      source: "project",
      trust: "trusted",
    }));
    const catalog = renderSkillCatalog(skills);
    expect(catalog?.length).toBeLessThan(33_000);
    expect(catalog).toContain("more skills omitted");
  });
});
