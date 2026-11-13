import skillsCatalogPrompt from "../../prompts/skills-catalog.md" with { type: "text" };
import { markdownValue } from "../util/markdown";
import { oneLine } from "../util/text";
import type { Skill, SkillSource, SkillTrust } from "./schema";

const MAX_CATALOG_CHARS = 32_000;
const MAX_DESCRIPTION_CHARS = 1500;

export interface SkillCommand {
  name: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  allowedTools: string[];
  argumentHint?: string;
  version?: string;
}

export function listSkillCommands(skills: readonly Skill[]): SkillCommand[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    trust: skill.trust,
    allowedTools: skill.allowedTools ?? [],
    ...(skill.argumentHint ? { argumentHint: skill.argumentHint } : {}),
    ...(skill.version ? { version: skill.version } : {}),
  }));
}

function catalogLine(skill: Skill): string {
  let description = oneLine(skill.description);
  if (description.length > MAX_DESCRIPTION_CHARS) {
    description = `${description.slice(0, MAX_DESCRIPTION_CHARS)}...`;
  }
  return [
    "## Skill",
    `- Name: ${markdownValue(skill.name)}`,
    `- Description: ${markdownValue(description)}`,
    `- Trust: ${markdownValue(skill.trust)}`,
    ...(skill.version ? [`- Version: ${markdownValue(skill.version)}`] : []),
    ...(skill.allowedTools?.length
      ? [`- Allowed tools: ${skill.allowedTools.map(markdownValue).join(", ")}`]
      : []),
  ].join("\n");
}

export function renderSkillCatalog(skills: Skill[]): string | undefined {
  if (skills.length === 0) return undefined;
  const lines = ["# Available skills", "", skillsCatalogPrompt.trim(), ""];
  let used = lines.join("\n").length;
  let included = 0;
  for (const skill of skills) {
    const line = catalogLine(skill);
    if (used + line.length + 1 > MAX_CATALOG_CHARS) break;
    lines.push(line, "");
    used += line.length + 2;
    included += 1;
  }
  if (included < skills.length) {
    lines.push(`- ${skills.length - included} more skills omitted from the catalog`);
  }
  return lines.join("\n");
}
