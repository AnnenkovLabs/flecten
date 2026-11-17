import { z } from "zod";

export const SKILL_SOURCES = [
  "user-claude",
  "user-agents",
  "user-flecten",
  "project-claude",
  "project-agents",
  "project-flecten",
] as const;

export const SkillSourceIdSchema = z.preprocess(
  (value) =>
    value === "user-liquid"
      ? "user-flecten"
      : value === "project-liquid"
        ? "project-flecten"
        : value,
  z.enum(SKILL_SOURCES),
);
export type SkillSourceId = z.infer<typeof SkillSourceIdSchema>;

export const SkillsConfigSchema = z.object({
  trust: z.record(z.string().min(1).max(256), z.enum(["trusted", "untrusted"])).optional(),
  sources: z
    .array(SkillSourceIdSchema)
    .max(SKILL_SOURCES.length)
    .default([...SKILL_SOURCES]),
});
