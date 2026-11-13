import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SKILL_SOURCES, type SkillSourceId } from "../config/skills";
import {
  MAX_SKILL_BYTES,
  parseSkillFile,
  type Skill,
  type SkillDiagnostic,
  type SkillSource,
  type SkillTrust,
} from "./schema";

const MAX_SKILLS = 200;

export interface SkillScope {
  id: SkillSourceId;
  directory: string;
  source: SkillSource;
}

export interface SkillDiscovery {
  skills: Skill[];
  diagnostics: SkillDiagnostic[];
}

export interface DiscoverSkillsOptions {
  home?: string;
  sources?: readonly SkillSourceId[] | undefined;
  trust?: Readonly<Record<string, SkillTrust>> | undefined;
}

export function skillScopes(cwd: string, home: string): SkillScope[] {
  return [
    { id: "user-claude", directory: join(home, ".claude", "skills"), source: "user" },
    { id: "user-agents", directory: join(home, ".agents", "skills"), source: "user" },
    { id: "user-liquid", directory: join(home, ".liquid", "skills"), source: "user" },
    { id: "project-claude", directory: join(cwd, ".claude", "skills"), source: "project" },
    { id: "project-agents", directory: join(cwd, ".agents", "skills"), source: "project" },
    { id: "project-liquid", directory: join(cwd, ".liquid", "skills"), source: "project" },
  ];
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readSkill(
  directory: string,
  source: SkillSource,
  diagnostics: SkillDiagnostic[],
): Promise<{ skill: Skill } | undefined> {
  const location = join(directory, "SKILL.md");
  try {
    const info = await stat(location);
    if (!info.isFile()) return undefined;
    if (info.size > MAX_SKILL_BYTES) {
      diagnostics.push({
        level: "error",
        source: location,
        message: `SKILL.md is ${Math.round(info.size / 1024)}KB; limit is ${MAX_SKILL_BYTES / 1024}KB`,
      });
      return undefined;
    }
    const parsed = parseSkillFile(await Bun.file(location).text(), location, directory, { source });
    diagnostics.push(...parsed.diagnostics);
    return parsed.skill ? { skill: parsed.skill } : undefined;
  } catch (error) {
    diagnostics.push({
      level: "error",
      source: location,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function discoverSkills(
  cwd: string,
  options: DiscoverSkillsOptions = {},
): Promise<SkillDiscovery> {
  const diagnostics: SkillDiagnostic[] = [];
  const skills = new Map<string, Skill>();
  const sourceOf = new Map<string, string>();
  const root = resolve(cwd);
  const home = resolve(options.home ?? homedir());
  const enabled = new Set(options.sources ?? SKILL_SOURCES);

  for (const scope of skillScopes(root, home)) {
    if (!enabled.has(scope.id)) continue;
    if (!(await isDirectory(scope.directory))) continue;

    const entries = await readdir(scope.directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        diagnostics.push({
          level: "warning",
          source: scope.directory,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      },
    );
    if (!entries) continue;

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const directory = join(scope.directory, entry.name);
      if (!(await isDirectory(directory))) continue;

      const loaded = await readSkill(directory, scope.source, diagnostics);
      if (!loaded) continue;
      const trust = options.trust?.[loaded.skill.name];
      const skill = trust === undefined ? loaded.skill : { ...loaded.skill, trust };
      if (skills.size >= MAX_SKILLS && !skills.has(skill.name)) {
        diagnostics.push({
          level: "error",
          source: skill.location,
          message: `skill catalog is full at ${MAX_SKILLS} entries; this skill was ignored`,
        });
        continue;
      }

      const previous = sourceOf.get(skill.name);
      if (previous) {
        diagnostics.push({
          level: "warning",
          source: skill.location,
          message: `skill "${skill.name}" overrides ${previous}`,
        });
      }
      skills.set(skill.name, skill);
      sourceOf.set(skill.name, skill.location);
    }
  }

  return {
    skills: [...skills.values()].sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
  };
}
