import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import continuePrompt from "../../prompts/continue.md" with { type: "text" };
import skillCommandPrompt from "../../prompts/skill-command.md" with { type: "text" };

export const MAX_COMMAND_BYTES = 64 * 1024;
export const MAX_COMMANDS = 200;

export type CommandScope = "user" | "project";

export interface CustomCommand {
  name: string;
  description: string;
  hint?: string;
  template: string;
  source: string;
  scope: CommandScope;
}

export interface SlashEntry {
  name: string;
  description?: string;
  hint?: string;
  source: "command" | "skill";
}

export interface CommandDirectory {
  dir: string;
  scope: CommandScope;
}

/** Later directories override earlier ones, so project commands win over user commands. */
export function commandDirectories(cwd: string, home: string): CommandDirectory[] {
  return [
    { dir: join(home, ".claude", "commands"), scope: "user" },
    { dir: join(home, ".liquid", "commands"), scope: "user" },
    { dir: join(cwd, ".claude", "commands"), scope: "project" },
    { dir: join(cwd, ".liquid", "commands"), scope: "project" },
  ];
}

function isNameChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "-" || char === "_"
  );
}

export function isCommandName(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  for (const char of name) if (!isNameChar(char)) return false;
  return true;
}

/** Splits `---` YAML frontmatter from the body without pattern matching. */
export function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const firstBreak = clean.indexOf("\n");
  if (firstBreak < 0 || clean.slice(0, firstBreak).trim() !== "---")
    return { data: {}, body: clean };
  let cursor = firstBreak + 1;
  while (cursor <= clean.length) {
    const next = clean.indexOf("\n", cursor);
    const end = next < 0 ? clean.length : next;
    if (clean.slice(cursor, end).trim() === "---") {
      const yaml = clean.slice(firstBreak + 1, cursor);
      const body = next < 0 ? "" : clean.slice(next + 1);
      try {
        const parsed = Bun.YAML.parse(yaml);
        const data =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
        return { data, body };
      } catch {
        return { data: {}, body };
      }
    }
    if (next < 0) break;
    cursor = next + 1;
  }
  return { data: {}, body: clean };
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 160);
  }
  return "";
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseCommandFile(
  text: string,
  name: string,
  source: string,
  scope: CommandScope,
): CustomCommand | undefined {
  const { data, body } = splitFrontmatter(text);
  const template = body.trim();
  if (template.length === 0 || !isCommandName(name)) return undefined;
  const hint = stringField(data, "argument-hint") ?? stringField(data, "hint");
  return {
    name,
    description: stringField(data, "description") ?? firstLine(template),
    ...(hint ? { hint } : {}),
    template,
    source,
    scope,
  };
}

export async function loadCustomCommands(
  directories: readonly CommandDirectory[],
): Promise<CustomCommand[]> {
  const commands = new Map<string, CustomCommand>();
  for (const { dir, scope } of directories) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const file = join(dir, entry.name);
      const info = await stat(file).catch(() => undefined);
      if (!info || info.size > MAX_COMMAND_BYTES) continue;
      const text = await readFile(file, "utf8").catch(() => "");
      const name = entry.name.slice(0, -3).toLowerCase();
      const command = parseCommandFile(text, name, file, scope);
      if (!command) continue;
      if (!commands.has(name) && commands.size >= MAX_COMMANDS) continue;
      commands.set(name, command);
    }
  }
  return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const char of text) {
    if (char === " " || char === "\t" || char === "\n") {
      if (current) words.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) words.push(current);
  return words;
}

/** `$ARGUMENTS` takes the whole argument string, `$1` to `$9` take single words. */
export function expandTemplate(template: string, args: string): string {
  const full = args.trim();
  const words = splitWords(full);
  let result = template.replaceAll("$ARGUMENTS", full);
  for (let index = 9; index >= 1; index -= 1) {
    result = result.replaceAll(`$${index}`, words[index - 1] ?? "");
  }
  if (!template.includes("$ARGUMENTS") && full.length > 0 && result === template) {
    result = `${result}\n\n${full}`;
  }
  return result;
}

/** Reads `/name args` at the start of a prompt. Only exact names of known entries count. */
export function parseSlash(
  prompt: string,
  known: ReadonlySet<string>,
): { name: string; args: string } | undefined {
  if (!prompt.startsWith("/")) return undefined;
  let end = 1;
  while (end < prompt.length && isNameChar(prompt.charAt(end))) end += 1;
  const name = prompt.slice(1, end);
  const next = prompt.charAt(end);
  if (next !== "" && next !== " " && next !== "\n" && next !== "\t") return undefined;
  if (!known.has(name)) return undefined;
  return { name, args: prompt.slice(end).trim() };
}

export function skillInvocation(name: string, args: string): string {
  return skillCommandPrompt
    .replaceAll("{{name}}", name)
    .replaceAll("{{arguments}}", args.length > 0 ? args : "(no extra arguments)")
    .trim();
}

/**
 * Expands a slash command typed in the composer into the prompt the model receives.
 * The thread keeps showing what the user typed.
 */
/**
 * Prompt commands the harness ships. `/continue` resumes an interrupted task from history
 * instead of starting it again. A user or project command with the same name wins.
 */
export const BUILTIN_PROMPTS: Readonly<Record<string, string>> = {
  continue: continuePrompt.trim(),
};

export function expandSlashPrompt(
  prompt: string,
  commands: readonly CustomCommand[],
  skills: readonly string[],
): string {
  const byName = new Map(commands.map((command) => [command.name, command]));
  const known = new Set([...Object.keys(BUILTIN_PROMPTS), ...byName.keys(), ...skills]);
  const slash = parseSlash(prompt, known);
  if (!slash) return prompt;
  const command = byName.get(slash.name);
  if (command) return expandTemplate(command.template, slash.args);
  const builtin = BUILTIN_PROMPTS[slash.name];
  if (builtin !== undefined) return expandTemplate(builtin, slash.args);
  return skillInvocation(slash.name, slash.args);
}

export function slashEntries(
  commands: readonly CustomCommand[],
  skills: readonly { name: string; description: string; argumentHint?: string }[],
): SlashEntry[] {
  return [
    ...commands.map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.hint ? { hint: command.hint } : {}),
      source: "command" as const,
    })),
    ...skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(skill.argumentHint ? { hint: skill.argumentHint } : {}),
      source: "skill" as const,
    })),
  ];
}
