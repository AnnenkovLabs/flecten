import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const MAX_SKILL_RESOURCES = 200;
const MAX_RESOURCE_DEPTH = 4;

export async function listSkillResources(
  directory: string,
  limit = MAX_SKILL_RESOURCES,
): Promise<string[]> {
  const resources: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_RESOURCE_DEPTH || resources.length >= limit) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (resources.length >= limit) return;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      const rel = relative(directory, path);
      if (rel === "SKILL.md") continue;
      resources.push(rel.split(sep).join("/"));
    }
  }

  await walk(directory, 0);
  return resources;
}
