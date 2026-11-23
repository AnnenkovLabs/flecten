import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { BUILTIN_SKILL_NAMES, builtinSkills } from "../../src/skills/builtin";
import { renderSkillCatalog } from "../../src/skills/catalog";
import { discoverSkills } from "../../src/skills/discover";
import { readSkillResource } from "../../src/skills/resource";
import { listSkillResourcesFor } from "../../src/skills/resources";
import { createSkillTool } from "../../src/skills/tool";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { toolSubject } from "../../ui/src/lib/tool-presentation";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "flecten-builtin-skills-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string, sessionId = "s_builtin"): ToolContext {
  return {
    sessionId,
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".flecten/logs"),
    limits,
    reads: new ReadTracker(),
  };
}

describe("built-in skills", () => {
  test("ships convert-plugin and self-config with compact catalog and lazy references/playbooks", async () => {
    expect(BUILTIN_SKILL_NAMES).toEqual(["convert-plugin", "self-config"]);
    const loaded = builtinSkills();
    expect(loaded.map((skill) => skill.name)).toEqual(["convert-plugin", "self-config"]);

    const catalog = renderSkillCatalog(loaded) ?? "";
    expect(catalog).toContain("convert-plugin");
    expect(catalog).toContain("self-config");
    // Catalog must stay concise and never inline reference/playbook bodies.
    expect(catalog.length).toBeLessThan(2000);
    expect(catalog).not.toContain("ExtensionAPI");
    expect(catalog).not.toContain("Plugin.define");
    expect(catalog).not.toContain("cordis.patch.yml");
    expect(catalog).not.toContain("AnnenkovLabs");

    const [convertSkill, selfConfigSkill] = loaded;
    if (!convertSkill || !selfConfigSkill) throw new Error("expected built-in skills");

    const convertResources = await listSkillResourcesFor(convertSkill);
    expect(convertResources).toEqual([
      "references/deepseek-harness.md",
      "references/flecten-target.md",
      "references/oh-my-pi.md",
      "references/opencode-1.md",
      "references/opencode-2.md",
      "references/pi.md",
    ]);

    const selfConfigResources = await listSkillResourcesFor(selfConfigSkill);
    expect(selfConfigResources).toEqual([
      "playbooks/about-and-support.md",
      "playbooks/access-and-security.md",
      "playbooks/config-and-settings.md",
      "playbooks/extensions-and-automation.md",
      "playbooks/features-and-guides.md",
      "playbooks/providers-and-models.md",
    ]);

    const cwd = await tempDir();
    const skillTool = createSkillTool(loaded);
    if (!skillTool) throw new Error("expected skill tool");
    const registry = new ToolRegistry([skillTool], { limits });

    const convertActivation = await registry.run(
      { id: "c1", name: "skill", args: { name: "convert-plugin" } },
      context(cwd),
    );
    expect(convertActivation.ok).toBe(true);
    for (const resource of convertResources) {
      expect(convertActivation.output).toContain(resource);
      const read = await registry.run(
        { id: `cr-${resource}`, name: "skill", args: { name: "convert-plugin", resource } },
        context(cwd),
      );
      expect(read.ok).toBe(true);
      expect(read.output).toContain(`- Path: \`${resource}\``);
      expect(read.output).not.toContain("\u2014");
    }

    const selfActivation = await registry.run(
      { id: "s1", name: "skill", args: { name: "self-config" } },
      context(cwd),
    );
    expect(selfActivation.ok).toBe(true);
    for (const resource of selfConfigResources) {
      expect(selfActivation.output).toContain(resource);
      const read = await registry.run(
        { id: `sr-${resource}`, name: "skill", args: { name: "self-config", resource } },
        context(cwd),
      );
      expect(read.ok).toBe(true);
      expect(read.output).toContain(`- Path: \`${resource}\``);
      expect(read.output).not.toContain("\u2014");
    }

    const missing = await registry.run(
      {
        id: "bad-path",
        name: "skill",
        args: { name: "self-config", resource: "../convert-plugin/SKILL.md" },
      },
      context(cwd),
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("Resource is not listed");
  });

  test("lets project/user skills override built-in skills and respects trust and allowed-tools on resource reads", async () => {
    const cwd = await tempDir();
    const home = await tempDir();
    const overrideDir = join(cwd, ".flecten/skills/self-config");
    await mkdir(overrideDir, { recursive: true });
    await writeFile(
      join(overrideDir, "SKILL.md"),
      "---\nname: self-config\ndescription: Custom project override\n---\nCustom instructions.\n",
    );

    const discovered = await discoverSkills(cwd, {
      home,
      builtin: true,
      sources: ["project-flecten"],
      trust: { "convert-plugin": "untrusted" },
    });
    expect(discovered.skills.map((skill) => skill.name)).toEqual(["convert-plugin", "self-config"]);
    expect(discovered.skills.find((skill) => skill.name === "self-config")?.source).toBe("project");
    expect(discovered.diagnostics.some((entry) => entry.message.includes("overrides"))).toBe(true);

    const tool = createSkillTool(discovered.skills);
    if (!tool) throw new Error("expected skill tool");
    const registry = new ToolRegistry([tool], { limits });
    const blocked = await registry.run(
      {
        id: "untrusted-res",
        name: "skill",
        args: { name: "convert-plugin", resource: "references/pi.md" },
      },
      context(cwd),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("not trusted");

    const restrictedDir = join(cwd, ".flecten/skills/restricted");
    await mkdir(join(restrictedDir, "notes"), { recursive: true });
    await writeFile(
      join(restrictedDir, "SKILL.md"),
      "---\nname: restricted\ndescription: Restricted\nallowed-tools: read\n---\nRead only.\n",
    );
    await writeFile(join(restrictedDir, "notes/info.md"), "Restricted guide.\n");
    const restrictedDiscovery = await discoverSkills(cwd, {
      home,
      sources: ["project-flecten"],
    });
    const restrictedTool = createSkillTool(restrictedDiscovery.skills);
    if (!restrictedTool) throw new Error("expected restricted skill tool");
    const restrictedRegistry = new ToolRegistry([restrictedTool], { limits });
    const premature = await restrictedRegistry.run(
      {
        id: "premature",
        name: "skill",
        args: { name: "restricted", resource: "notes/info.md" },
      },
      context(cwd),
    );
    expect(premature.ok).toBe(false);
    expect(premature.error).toContain("Activate skill");
    expect(
      (
        await restrictedRegistry.run(
          { id: "activate", name: "skill", args: { name: "restricted" } },
          context(cwd),
        )
      ).ok,
    ).toBe(true);
    const afterActivation = await restrictedRegistry.run(
      {
        id: "after",
        name: "skill",
        args: { name: "restricted", resource: "notes/info.md" },
      },
      context(cwd),
    );
    expect(afterActivation.ok).toBe(true);
    expect(afterActivation.output).toContain("Restricted guide.");
  });

  test("wires built-in skills into AppService by default, survives untrusted folders, and toggles off cleanly", async () => {
    const cwd = await tempDir();
    const config = defaultConfig();
    config.catalog.autoRefresh = false;
    config.skills = { sources: [], builtin: true };
    await writeFile(join(cwd, "flecten.config.json"), JSON.stringify(config));

    const service = await createAppService(cwd);
    try {
      // Built-in skills work even before workspace trust is accepted.
      expect(service.info().skills.names).toEqual(["convert-plugin", "self-config"]);
      const listed = await service.extensions.skills();
      expect(listed.map((skill) => skill.name)).toEqual(["convert-plugin", "self-config"]);
      expect(listed.find((skill) => skill.name === "convert-plugin")?.resources).toContain(
        "references/opencode-2.md",
      );
      const preview = await service.extensions.skillResource(
        "self-config",
        "playbooks/about-and-support.md",
      );
      expect(preview.text).toContain("AnnenkovLabs");
      expect(preview.text).toContain("https://github.com/AnnenkovLabs/flecten/issues");

      const convertPlugin = builtinSkills()[0];
      if (!convertPlugin) throw new Error("expected convert-plugin built-in skill");
      const direct = await readSkillResource(convertPlugin, "references/deepseek-harness.md");
      expect(direct.text).toContain("Cordis");

      const draft = service.settings().config;
      draft.skills = { sources: [], builtin: false };
      const saved = await service.saveSettings({ config: draft });
      expect(saved.skills.names).toEqual([]);
    } finally {
      await service.dispose();
    }
  });

  test("formats UI labels for skill resources", () => {
    expect(
      toolSubject({
        id: "1",
        name: "skill",
        args: { name: "convert-plugin", resource: "references/pi.md" },
      }),
    ).toBe("convert-plugin: references/pi.md");
  });
});
