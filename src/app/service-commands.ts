import { homedir } from "node:os";
import {
  commandDirectories,
  expandSlashPrompt,
  loadCustomCommands,
  type SlashEntry,
  slashEntries,
} from "../commands/custom";
import type { Skill } from "../skills/schema";

/** What an interrupted run gets as its prompt when it resumes. */
export const RESUME_PROMPT = "/continue";

/**
 * Slash commands from `.claude/commands` and `.liquid/commands` (user and project) plus skills.
 * Files are read on every call, so a new command works without a restart.
 */
export function slashCommands(
  cwd: string,
  skills: () => readonly Skill[],
  extra: () => readonly string[] = () => [],
) {
  const directories = () => [
    ...commandDirectories(cwd, homedir()),
    ...extra().map((dir) => ({ dir, scope: "project" as const })),
  ];
  return {
    async list(): Promise<SlashEntry[]> {
      return slashEntries(await loadCustomCommands(directories()), skills());
    },
    async expand(prompt: string): Promise<string> {
      if (!prompt.startsWith("/")) return prompt;
      const commands = await loadCustomCommands(directories()).catch(() => []);
      const names = skills().map((skill) => skill.name);
      return expandSlashPrompt(prompt, commands, names);
    },
  };
}
