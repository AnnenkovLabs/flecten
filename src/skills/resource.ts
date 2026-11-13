import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { listSkillResources } from "./resources";
import type { Skill } from "./schema";
import { MAX_SKILL_BYTES } from "./schema";

/** A selected resource is previewed as text, never executed or added as instructions. */
export async function readSkillResource(skill: Skill, path: string) {
  const available = await listSkillResources(skill.directory);
  if (!available.includes(path)) throw new Error("Выберите файл из списка ресурсов навыка");
  const [root, target] = await Promise.all([
    realpath(skill.directory),
    realpath(resolve(skill.directory, path)),
  ]);
  const local = relative(root, target);
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
    throw new Error("Ресурс выходит за папку навыка");
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Ресурс должен быть обычным файлом");
  const blob = Bun.file(target).slice(0, MAX_SKILL_BYTES);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.includes(0)) throw new Error("Бинарный ресурс нельзя открыть как текст");
  return {
    name: skill.name,
    path,
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    truncated: info.size > MAX_SKILL_BYTES,
  };
}
