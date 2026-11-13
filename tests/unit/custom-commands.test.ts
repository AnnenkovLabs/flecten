import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slashCommands } from "../../src/app/service-commands";
import {
  BUILTIN_PROMPTS,
  commandDirectories,
  expandSlashPrompt,
  expandTemplate,
  loadCustomCommands,
  parseCommandFile,
  parseSlash,
  slashEntries,
  splitFrontmatter,
} from "../../src/commands/custom";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-commands-"));
  dirs.push(dir);
  return dir;
}

describe("custom slash commands", () => {
  test("frontmatter is split without patterns and bad YAML keeps the body", () => {
    expect(splitFrontmatter("---\ndescription: Review\n---\nBody")).toEqual({
      data: { description: "Review" },
      body: "Body",
    });
    expect(splitFrontmatter("---\n: [broken\n---\nBody").body).toBe("Body");
    expect(splitFrontmatter("No frontmatter").body).toBe("No frontmatter");
  });

  test("a command file gives description, hint and template", () => {
    const command = parseCommandFile(
      "---\ndescription: Review a PR\nargument-hint: <number>\n---\nReview PR $1 carefully.",
      "review",
      "/x/review.md",
      "project",
    );
    expect(command).toMatchObject({ name: "review", description: "Review a PR", hint: "<number>" });
    expect(parseCommandFile("Just do it", "Bad Name", "/x", "user")).toBeUndefined();
    expect(parseCommandFile("---\na: 1\n---\n   ", "empty", "/x", "user")).toBeUndefined();
  });

  test("templates take $ARGUMENTS and positional words; plain templates get args appended", () => {
    expect(expandTemplate("Fix $ARGUMENTS now", "the login bug")).toBe("Fix the login bug now");
    expect(expandTemplate("Compare $1 with $2", "main dev")).toBe("Compare main with dev");
    expect(expandTemplate("Write tests", "for parser")).toBe("Write tests\n\nfor parser");
  });

  test("only exact known names count as slash commands", () => {
    const known = new Set(["review"]);
    expect(parseSlash("/review 12", known)).toEqual({ name: "review", args: "12" });
    expect(parseSlash("/reviewer 12", known)).toBeUndefined();
    expect(parseSlash("/usr/bin/env is a path", known)).toBeUndefined();
    expect(parseSlash("review 12", known)).toBeUndefined();
  });

  test("skills expand into an explicit skill tool call", () => {
    const prompt = expandSlashPrompt("/pdf-tools split the file", [], ["pdf-tools"]);
    expect(prompt).toContain('Call the `skill` tool with the name "pdf-tools"');
    expect(prompt).toContain("split the file");
    expect(expandSlashPrompt("/unknown thing", [], ["pdf-tools"])).toBe("/unknown thing");
  });

  test("/continue resumes from history and a custom command of the same name wins", () => {
    const resumed = expandSlashPrompt("/continue", [], []);
    expect(resumed).toBe(BUILTIN_PROMPTS.continue ?? "");
    expect(resumed).toContain("Do not start over");
    expect(expandSlashPrompt("/continue skip the docs", [], [])).toEndWith("skip the docs");
    const custom = {
      name: "continue",
      description: "mine",
      template: "my own continue",
      source: "x.md",
      scope: "project" as const,
    };
    expect(expandSlashPrompt("/continue", [custom], [])).toBe("my own continue");
  });

  test("project commands override user commands and the menu lists commands and skills", async () => {
    const home = await temp();
    const cwd = await temp();
    await mkdir(join(home, ".claude", "commands"), { recursive: true });
    await mkdir(join(cwd, ".liquid", "commands"), { recursive: true });
    await writeFile(join(home, ".claude", "commands", "ship.md"), "User ship");
    await writeFile(
      join(cwd, ".liquid", "commands", "ship.md"),
      "---\ndescription: Ship it\n---\nProject ship $ARGUMENTS",
    );
    await writeFile(join(cwd, ".liquid", "commands", "notes.txt"), "ignored");

    const commands = await loadCustomCommands(commandDirectories(cwd, home));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ name: "ship", scope: "project", description: "Ship it" });
    expect(expandSlashPrompt("/ship v2", commands, [])).toBe("Project ship v2");
    expect(slashEntries(commands, [{ name: "pdf", description: "PDF skill" }])).toEqual([
      { name: "ship", description: "Ship it", source: "command" },
      { name: "pdf", description: "PDF skill", source: "skill" },
    ]);
  });

  test("the service reads command files on every call, so new commands work without a restart", async () => {
    const cwd = await temp();
    const commands = slashCommands(cwd, () => []);
    expect(await commands.expand("/later now")).toBe("/later now");
    await mkdir(join(cwd, ".claude", "commands"), { recursive: true });
    await writeFile(join(cwd, ".claude", "commands", "later.md"), "Do it $ARGUMENTS");
    expect(await commands.expand("/later now")).toBe("Do it now");
    expect((await commands.list()).map((entry) => entry.name)).toContain("later");
    expect(await commands.expand("plain text")).toBe("plain text");
  });
});
