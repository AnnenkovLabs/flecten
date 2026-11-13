import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { z } from "zod";
import type { ToolResult } from "../core/types";
import { defineTool, type Tool } from "../tools/types";
import { markdownValue } from "../util/markdown";
import { listSkillResources, MAX_SKILL_RESOURCES } from "./resources";
import { MAX_SKILL_BYTES, parseSkillFile, type Skill, type SkillTrust } from "./schema";

export interface SkillActivationData {
  kind: "skill";
  name: string;
  directory: string;
  resources: string[];
  trust: SkillTrust;
  allowedTools: string[];
  version?: string;
  reused: boolean;
}

export interface CachedActivation {
  revision: string;
  output: string;
  data: Omit<SkillActivationData, "reused">;
}

function skillMessage(skill: Skill, body: string, resources: string[]): string {
  const lines = [
    "# Skill instructions",
    "",
    `- Name: ${markdownValue(skill.name)}`,
    `- Skill directory: ${markdownValue(skill.directory)}`,
    `- Trust: ${markdownValue(skill.trust)}`,
    ...(skill.version ? [`- Version: ${markdownValue(skill.version)}`] : []),
    ...(skill.allowedTools?.length
      ? [`- Allowed tools: ${skill.allowedTools.map(markdownValue).join(", ")}`]
      : []),
    "",
    "Relative paths in this skill are relative to the skill directory.",
    "",
    "## Instructions",
    "",
    body,
  ];
  if (resources.length > 0) {
    lines.push(
      "",
      "## Resources",
      "",
      ...resources.map((path) => `- Path: ${markdownValue(path)}`),
    );
    if (resources.length >= MAX_SKILL_RESOURCES) {
      lines.push(`Resource list capped at ${MAX_SKILL_RESOURCES} files.`);
    }
  }
  return lines.join("\n");
}

function activationData(skill: Skill, resources: string[]): Omit<SkillActivationData, "reused"> {
  return {
    kind: "skill",
    name: skill.name,
    directory: skill.directory,
    resources,
    trust: skill.trust,
    allowedTools: skill.allowedTools ?? [],
    ...(skill.version ? { version: skill.version } : {}),
  };
}

async function runSkill(
  name: string,
  byName: Map<string, Skill>,
  activations: Map<string, Map<string, CachedActivation>>,
  sessionId: string,
): Promise<ToolResult> {
  const skill = byName.get(name);
  if (!skill) {
    return { ok: false, output: "", error: `Unknown skill: ${name}` };
  }

  if (skill.trust === "untrusted") {
    return {
      ok: false,
      output: "",
      error: `Skill "${name}" is not trusted. Enable trust in skill settings before loading its instructions.`,
      data: { kind: "permission" },
    };
  }

  let text: string;
  try {
    const info = await stat(skill.location);
    if (!info.isFile() || info.size > MAX_SKILL_BYTES) {
      return {
        ok: false,
        output: "",
        error: `Skill "${name}" is missing or exceeds ${MAX_SKILL_BYTES / 1024}KB`,
      };
    }
    text = await Bun.file(skill.location).text();
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: `Cannot read skill "${name}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const revision = createHash("sha256").update(text).update(JSON.stringify(skill)).digest("hex");
  let session = activations.get(sessionId);
  const existing = session?.get(name);
  if (existing?.revision === revision) {
    return {
      ok: true,
      output: existing.output,
      data: { ...existing.data, reused: true } satisfies SkillActivationData,
    };
  }

  const parsed = parseSkillFile(text, skill.location, skill.directory, {
    source: skill.source,
    trust: skill.trust,
  });
  if (!parsed.skill || parsed.body === undefined) {
    return {
      ok: false,
      output: "",
      error: `Skill "${name}" is no longer valid: ${parsed.diagnostics[0]?.message ?? "unknown error"}`,
    };
  }
  if (parsed.skill.name !== name) {
    return {
      ok: false,
      output: "",
      error: `Skill "${name}" changed its name to "${parsed.skill.name}"; restart the app`,
    };
  }

  const resources = await listSkillResources(skill.directory);
  const current = parsed.skill;
  const output = skillMessage(current, parsed.body, resources);
  const data = activationData(current, resources);
  if (!session) {
    session = new Map();
    activations.set(sessionId, session);
  }
  session.set(name, { output, data, revision });
  return {
    ok: true,
    output,
    data: { ...data, reused: false } satisfies SkillActivationData,
  };
}

export type SkillActivations = Map<string, Map<string, CachedActivation>>;

export function createSkillTool(
  skills: Skill[],
  activations: SkillActivations = new Map(),
): Tool | undefined {
  if (skills.length === 0) return undefined;
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const names = [...byName.keys()] as [string, ...string[]];

  return defineTool({
    name: "skill",
    source: "skill",
    mutating: true,
    description:
      "Load the full instructions for an installed Agent Skill. Call it when a task matches a skill description, before doing the work.",
    schema: z.object({
      name: z.enum(names).describe("Skill name from the Available skills catalog"),
    }),
    execute: (args, context) => runSkill(args.name, byName, activations, context.sessionId),
  });
}
