import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import deepseekHarnessRef from "../../prompts/skills/convert-plugin/references/deepseek-harness.md" with {
  type: "text",
};
import flectenTargetRef from "../../prompts/skills/convert-plugin/references/flecten-target.md" with {
  type: "text",
};
import ohMyPiRef from "../../prompts/skills/convert-plugin/references/oh-my-pi.md" with {
  type: "text",
};
import opencode1Ref from "../../prompts/skills/convert-plugin/references/opencode-1.md" with {
  type: "text",
};
import opencode2Ref from "../../prompts/skills/convert-plugin/references/opencode-2.md" with {
  type: "text",
};
import piRef from "../../prompts/skills/convert-plugin/references/pi.md" with { type: "text" };
import convertPluginSkill from "../../prompts/skills/convert-plugin/SKILL.md" with { type: "text" };
import aboutSupportPlaybook from "../../prompts/skills/self-config/playbooks/about-and-support.md" with {
  type: "text",
};
import accessSecurityPlaybook from "../../prompts/skills/self-config/playbooks/access-and-security.md" with {
  type: "text",
};
import configSettingsPlaybook from "../../prompts/skills/self-config/playbooks/config-and-settings.md" with {
  type: "text",
};
import extensionsAutomationPlaybook from "../../prompts/skills/self-config/playbooks/extensions-and-automation.md" with {
  type: "text",
};
import featuresGuidesPlaybook from "../../prompts/skills/self-config/playbooks/features-and-guides.md" with {
  type: "text",
};
import providersModelsPlaybook from "../../prompts/skills/self-config/playbooks/providers-and-models.md" with {
  type: "text",
};
import selfConfigSkill from "../../prompts/skills/self-config/SKILL.md" with { type: "text" };
import { productEnv } from "../../shared/environment.cjs";
import { parseSkillFile, type Skill, type SkillTrust } from "./schema";

export interface BuiltinSkillBundle {
  readonly name: string;
  readonly skillMd: string;
  readonly resources: Readonly<Record<string, string>>;
}

const BUNDLES: readonly BuiltinSkillBundle[] = [
  {
    name: "convert-plugin",
    skillMd: convertPluginSkill,
    resources: {
      "references/deepseek-harness.md": deepseekHarnessRef,
      "references/flecten-target.md": flectenTargetRef,
      "references/oh-my-pi.md": ohMyPiRef,
      "references/opencode-1.md": opencode1Ref,
      "references/opencode-2.md": opencode2Ref,
      "references/pi.md": piRef,
    },
  },
  {
    name: "self-config",
    skillMd: selfConfigSkill,
    resources: {
      "playbooks/about-and-support.md": aboutSupportPlaybook,
      "playbooks/access-and-security.md": accessSecurityPlaybook,
      "playbooks/config-and-settings.md": configSettingsPlaybook,
      "playbooks/extensions-and-automation.md": extensionsAutomationPlaybook,
      "playbooks/features-and-guides.md": featuresGuidesPlaybook,
      "playbooks/providers-and-models.md": providersModelsPlaybook,
    },
  },
];

const BY_NAME = new Map<string, BuiltinSkillBundle>(BUNDLES.map((entry) => [entry.name, entry]));

export const BUILTIN_SKILL_NAMES = BUNDLES.map((entry) => entry.name);

function builtinSkillDirectory(name: string): string {
  const candidates: string[] = [];
  const env = productEnv("PROMPTS_DIR")?.trim();
  if (env) candidates.push(join(env, "skills", name));
  candidates.push(join(dirname(process.execPath), "prompts", "skills", name));
  candidates.push(join(import.meta.dir, "../../prompts/skills", name));
  candidates.push(join(process.cwd(), "prompts", "skills", name));
  for (const directory of candidates) {
    if (existsSync(join(directory, "SKILL.md"))) return directory;
  }
  return `builtin://${name}`;
}

export function builtinSkills(trust?: Readonly<Record<string, SkillTrust>>): Skill[] {
  const loaded: Skill[] = [];
  for (const bundle of BUNDLES) {
    const directory = builtinSkillDirectory(bundle.name);
    const location = directory.startsWith("builtin://")
      ? `${directory}/SKILL.md`
      : join(directory, "SKILL.md");
    const parsed = parseSkillFile(bundle.skillMd, location, directory, {
      source: "builtin",
      trust: trust?.[bundle.name] ?? "trusted",
    });
    if (parsed.skill) loaded.push(parsed.skill);
  }
  return loaded;
}

export function readBuiltinSkillFile(name: string): string | undefined {
  return BY_NAME.get(name)?.skillMd;
}

export function listBuiltinSkillResources(name: string): string[] {
  const bundle = BY_NAME.get(name);
  return bundle ? Object.keys(bundle.resources).sort() : [];
}

export function readBuiltinSkillResource(name: string, path: string) {
  const bundle = BY_NAME.get(name);
  if (!bundle || !Object.hasOwn(bundle.resources, path)) {
    throw new Error("Resource is not listed in this skill.");
  }
  const text = bundle.resources[path] ?? "";
  return { name, path, text, truncated: false };
}
