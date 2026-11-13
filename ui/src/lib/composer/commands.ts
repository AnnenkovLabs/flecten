import { t } from "../i18n.svelte";
import { fuzzyScore } from "./mentions";
import type { CommandItem, SkillCommand } from "./types";

export const BUILTIN_COMMANDS: readonly CommandItem[] = [
  {
    source: "builtin",
    name: "continue",
    get description() {
      return t("Continue the task where it stopped without starting over");
    },
    get hint() {
      return t("[clarification]");
    },
  },
  {
    source: "builtin",
    name: "undo",
    get description() {
      return t("Undo the last action and restore files");
    },
  },
  {
    source: "builtin",
    name: "redo",
    get description() {
      return t("Redo changes reverted by the undo command");
    },
  },
  {
    source: "builtin",
    name: "checkpoints",
    get description() {
      return t("Change history with files and sizes");
    },
    get hint() {
      return t("[number]");
    },
  },
  {
    source: "builtin",
    name: "compact",
    get description() {
      return t("Compact context to the page boundary");
    },
    get hint() {
      return t("[topic]");
    },
  },
  {
    source: "builtin",
    name: "clear",
    get description() {
      return t("Clear the conversation and start over");
    },
  },
  {
    source: "builtin",
    name: "model",
    get description() {
      return t("Switch provider and model for future turns");
    },
    get hint() {
      return t("[model]");
    },
  },
  {
    source: "builtin",
    name: "permissions",
    get description() {
      return t("Open read, write, and shell permissions");
    },
  },
  {
    source: "builtin",
    name: "terminal",
    get description() {
      return t("Open the project terminal");
    },
  },
  {
    source: "builtin",
    name: "new",
    get description() {
      return t("Create a new task in the current project");
    },
  },
  {
    source: "builtin",
    name: "search",
    get description() {
      return t("Find text or a file in the current session");
    },
    get hint() {
      return t("[query]");
    },
  },
  {
    source: "builtin",
    name: "export",
    get description() {
      return t("Save the conversation as Markdown");
    },
    get hint() {
      return t("[file]");
    },
  },
];

export interface ParsedCommand {
  name: string;
  args: string;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

export function parseCommandQuery(value: string): ParsedCommand {
  const start = value.startsWith("/") ? 1 : 0;
  let end = start;

  while (end < value.length && !isSpace(value.charCodeAt(end))) end += 1;

  let argsStart = end;
  while (argsStart < value.length && isSpace(value.charCodeAt(argsStart))) argsStart += 1;

  return { name: value.slice(start, end), args: value.slice(argsStart) };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function rank(items: readonly CommandItem[], needle: string, limit: number): CommandItem[] {
  if (needle.length === 0) return items.slice(0, limit);

  const scored: { item: CommandItem; score: number }[] = [];

  for (const item of items) {
    const nameScore = fuzzyScore(needle, item.name);
    const descriptionScore = fuzzyScore(needle, item.description);
    if (nameScore === null && descriptionScore === null) continue;

    const score = (nameScore ?? 0) * 3 + (descriptionScore ?? 0);
    scored.push({ item, score });
  }

  scored.sort(
    (left, right) => right.score - left.score || compareText(left.item.name, right.item.name),
  );

  return scored.slice(0, limit).map((entry) => entry.item);
}

export function filterCommands(
  query: string,
  skills: readonly SkillCommand[] = [],
  limitPerGroup = 12,
): CommandItem[] {
  const { name } = parseCommandQuery(query);
  const needle = name.toLowerCase();

  const skillItems: CommandItem[] = skills.map((skill) => ({
    source: "skill",
    name: skill.name,
    description: skill.description ?? t("Project skill"),
  }));

  return [
    ...rank(BUILTIN_COMMANDS, needle, limitPerGroup),
    ...rank(skillItems, needle, limitPerGroup),
  ];
}
