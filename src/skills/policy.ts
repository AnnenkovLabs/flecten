import type { Tool, ToolContext } from "../tools/types";
import type { SkillDiscovery } from "./discover";
import type { SkillActivations } from "./tool";

/** Activated skill allowlists narrow the session's normal permissions; they never grant access. */
export function skillToolPolicy(
  activations: SkillActivations | undefined,
  skills?: () => SkillDiscovery,
) {
  return (tool: Tool, context: ToolContext): string | undefined => {
    if (tool.name === "skill") return undefined;
    for (const { data } of activations?.get(context.sessionId)?.values() ?? []) {
      const current = skills?.().skills.find((skill) => skill.name === data.name);
      if (skills && (!current || current.trust === "untrusted"))
        return `Skill "${data.name}" is no longer trusted. Stop using its instructions and choose a trusted skill in settings.`;
      if (data.allowedTools.length === 0 || data.allowedTools.includes(tool.name)) continue;
      return `Skill "${data.name}" does not allow tool "${tool.name}". Allowed tools: ${data.allowedTools.join(", ")}. Change the skill or its permissions in settings before retrying.`;
    }
    return undefined;
  };
}
