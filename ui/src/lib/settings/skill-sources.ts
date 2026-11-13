export const SKILL_SOURCE_OPTIONS = [
  { id: "user-claude", label: "Claude", path: "~/.claude/skills", scope: "user" },
  { id: "user-agents", label: "agents", path: "~/.agents/skills", scope: "user" },
  { id: "user-liquid", label: "Flecten", path: "~/.liquid/skills", scope: "user" },
  { id: "project-claude", label: "Claude", path: ".claude/skills", scope: "project" },
  { id: "project-agents", label: "agents", path: ".agents/skills", scope: "project" },
  { id: "project-liquid", label: "Flecten", path: ".liquid/skills", scope: "project" },
] as const;

export type SkillSourceId = (typeof SKILL_SOURCE_OPTIONS)[number]["id"];
