import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { HarnessConfigSchema } from "../../src/config/schema";
import { SKILL_SOURCES, SkillsConfigSchema } from "../../src/config/skills";
import { SKILL_SOURCE_OPTIONS } from "../../ui/src/lib/settings/skill-sources";
import { cleanSettings, settingsDirty } from "../../ui/src/lib/settings-utils";
import type { HarnessSettings } from "../../ui/src/lib/types";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill source settings", () => {
  test("validates source ids and keeps UI ids aligned with the config", () => {
    expect(SkillsConfigSchema.parse({}).sources).toEqual([...SKILL_SOURCES]);
    expect(SKILL_SOURCE_OPTIONS.map((source) => source.id)).toEqual([...SKILL_SOURCES]);
    expect(HarnessConfigSchema.safeParse({ skills: { sources: ["unknown"] } }).success).toBe(false);
    expect(HarnessConfigSchema.safeParse({ skills: { sources: false } }).success).toBe(false);
    const config = defaultConfig() as unknown as HarnessSettings;
    const baseline = structuredClone(config);
    config.skills = { sources: ["user-agents"] };
    expect(settingsDirty(config, baseline)).toBe(true);
    expect(cleanSettings(config).skills).toEqual(config.skills);
  });

  test("saving refreshes status, slash commands and prompt and survives reopening", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-skill-sources-"));
    dirs.push(cwd);
    for (const [directory, name] of [
      [".claude", "claude-only"],
      [".agents", "agents-only"],
    ] as const) {
      const path = join(cwd, directory, "skills", name);
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} helper\n---\nHelp.\n`,
      );
    }
    const config = defaultConfig();
    config.catalog.autoRefresh = false;
    config.skills = { sources: ["project-claude", "project-agents"] };
    await writeFile(join(cwd, "flecten.config.json"), JSON.stringify(config));
    const service = await createAppService(cwd);
    try {
      await service.acceptTrust();
      expect(service.info().skills.names).toEqual(["agents-only", "claude-only"]);
      const before = service.info().system.hash;
      const draft = service.settings().config;
      draft.skills = { sources: ["project-agents"] };
      const saved = await service.saveSettings({ config: draft });
      expect(saved.skills.names).toEqual(["agents-only"]);
      expect(saved.system.hash).not.toBe(before);
      expect(
        (await service.listCommands())
          .filter((entry) => entry.source === "skill")
          .map((entry) => entry.name),
      ).toEqual(["agents-only"]);
      const stored = await Bun.file(join(cwd, "flecten.config.json")).json();
      expect(stored.skills.sources).toEqual(["project-agents"]);
      const reopened = await createAppService(cwd);
      try {
        expect(reopened.info().skills.names).toEqual(["agents-only"]);
        expect(reopened.settings().config.skills?.sources).toEqual(["project-agents"]);
      } finally {
        await reopened.dispose();
      }
      const empty = service.settings().config;
      empty.skills = { sources: [] };
      expect((await service.saveSettings({ config: empty })).skills.names).toEqual([]);
      expect((await service.listCommands()).filter((entry) => entry.source === "skill")).toEqual(
        [],
      );
      const restored = service.settings().config;
      restored.skills = { sources: ["project-claude"] };
      expect((await service.saveSettings({ config: restored })).skills.names).toEqual([
        "claude-only",
      ]);
    } finally {
      await service.dispose();
    }
  });
});
