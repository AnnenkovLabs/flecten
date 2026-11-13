import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstructionLocations } from "../../src/context";
import { promptBudget } from "../../src/context";
import { buildPrompt, buildSystemPrompt, promptStamp, promptVersion } from "../../src/core/prompt";

function locations(overrides: Partial<InstructionLocations> = {}): InstructionLocations {
  return {
    managed: [],
    user: [],
    project: [],
    local: [],
    nested: false,
    ...overrides,
  };
}

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "liquid-prompt-"));
}

describe("instruction hierarchy", () => {
  test("loads managed, user, project, local and nested sources in order", async () => {
    const cwd = await tempProject();
    try {
      const managedPath = join(cwd, "managed-AGENTS.md");
      const userPath = join(cwd, "user-AGENTS.md");
      const projectPath = join(cwd, "AGENTS.md");
      const localPath = join(cwd, "AGENTS.local.md");
      await writeFile(managedPath, "# Managed\nmanaged rule");
      await writeFile(userPath, "# User\nuser rule");
      await writeFile(projectPath, "# Project\nproject rule\n\n## Rules\n- project rule A");
      await writeFile(localPath, "# Local\nlocal rule");
      await mkdir(join(cwd, "packages", "app"), { recursive: true });
      await writeFile(join(cwd, "packages", "app", "AGENTS.md"), "# Nested\nnested rule");

      const built = await buildPrompt(cwd, {
        instructions: locations({
          managed: [managedPath],
          user: [userPath],
          project: [projectPath],
          local: [localPath],
          nested: true,
        }),
      });

      expect(built.instructions.sources.map((source) => source.kind)).toEqual([
        "managed",
        "user",
        "project",
        "local",
        "nested",
      ]);
      expect(built.instructions.sources.map((source) => source.path)).toEqual([
        managedPath,
        userPath,
        projectPath,
        localPath,
        join(cwd, "packages", "app", "AGENTS.md"),
      ]);
      expect(built.system).toContain("managed rule");
      expect(built.system).toContain("user rule");
      expect(built.system).toContain("project rule");
      expect(built.system).toContain("local rule");
      expect(built.system).toContain("nested rule");
      expect(built.system).toContain(`Applies to files under: ${join(cwd, "packages", "app")}`);
      expect(promptStamp(built, 24_000).instructions?.sources).toEqual(
        built.instructions.sources.map(({ kind, path }) => ({ kind, path })),
      );
      expect(built.system.indexOf("managed rule")).toBeLessThan(built.system.indexOf("user rule"));
      expect(built.system.indexOf("user rule")).toBeLessThan(built.system.indexOf("project rule"));
      expect(built.system.indexOf("project rule")).toBeLessThan(built.system.indexOf("local rule"));
      expect(built.system.indexOf("local rule")).toBeLessThan(built.system.indexOf("nested rule"));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reports conflicting headings with both source paths and keeps project rules", async () => {
    const cwd = await tempProject();
    try {
      const managedPath = join(cwd, "managed-AGENTS.md");
      const projectPath = join(cwd, "AGENTS.md");
      await writeFile(
        managedPath,
        "# Layer\n\n```bash\n# comment\n```\n\n## Rules\n- managed uses tabs",
      );
      await writeFile(
        projectPath,
        "# Project\n\n```bash\n# comment\n```\n\n## Rules\n- project uses spaces",
      );

      const built = await buildPrompt(cwd, {
        instructions: locations({ managed: [managedPath], project: [projectPath] }),
      });

      expect(built.system).toContain("- managed uses tabs");
      expect(built.system).toContain("- project uses spaces");
      expect(
        built.instructions.conflicts.some(
          (conflict) =>
            conflict.heading === "Rules" &&
            conflict.paths[0] === managedPath &&
            conflict.paths[1] === projectPath,
        ),
      ).toBe(true);
      expect(built.instructions.conflicts.some((conflict) => conflict.heading === "comment")).toBe(
        false,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("prompt version", () => {
  test("changes with a rule and ignores whitespace-only edits", async () => {
    expect(promptVersion("Rule A")).not.toBe(promptVersion("Rule B"));
    expect(promptVersion("Rule A\n\n  more text")).toBe(promptVersion("Rule A more text"));

    const cwd = await tempProject();
    try {
      const projectPath = join(cwd, "AGENTS.md");
      const project = locations({ project: [projectPath] });
      await writeFile(projectPath, "# Rules\n- use tabs");
      const tabs = await buildPrompt(cwd, { instructions: project });
      await writeFile(projectPath, "# Rules\n- use spaces");
      const spaces = await buildPrompt(cwd, { instructions: project });
      await writeFile(projectPath, "# Rules\n- use tabs   \n\n");
      const whitespace = await buildPrompt(cwd, { instructions: project });

      expect(tabs.version).not.toBe(spaces.version);
      expect(whitespace.version).toBe(tabs.version);
      expect(tabs.system).toContain("- use tabs");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("prompt budget", () => {
  test("trims optional sections with an explicit marker and keeps required rules", () => {
    const required = "R".repeat(400);
    const result = promptBudget({
      parts: [
        { id: "instructions", text: required, required: true },
        { id: "skills", text: "S".repeat(4_000) },
      ],
      maxTokens: 200,
    });

    expect(result.text).toContain(required);
    expect(result.text).toContain("chars omitted to fit the prompt budget");
    expect(result.trimmed).toEqual(["skills"]);
    expect(result.overBudget).toBe(false);
    expect(result.text.length).toBeLessThan(4_400);
  });

  test("keeps required rules whole when the cap cannot fit them", () => {
    const required = "R".repeat(500);
    const result = promptBudget({
      parts: [{ id: "instructions", text: required, required: true }],
      maxTokens: 10,
    });

    expect(result.text).toContain(required);
    expect(result.overBudget).toBe(true);
    expect(result.text).toContain("prompt budget exceeded");
  });

  test("counts tool schemas against the same cap without putting them in the prompt", () => {
    const base = "B".repeat(400);
    const skills = "S".repeat(2_000);
    const schemaText = "T".repeat(2_000);
    const withoutTools = promptBudget({
      parts: [
        { id: "base", text: base, required: true },
        { id: "skills", text: skills },
      ],
      maxTokens: 700,
    });
    const withTools = promptBudget({
      parts: [
        { id: "base", text: base, required: true },
        { id: "tool-schemas", text: schemaText, required: true, external: true },
        { id: "skills", text: skills },
      ],
      maxTokens: 700,
    });

    expect(withoutTools.trimmed).toEqual([]);
    expect(withTools.trimmed).toContain("skills");
    expect(withTools.externalTokens).toBeGreaterThan(0);
    expect(withTools.text).not.toContain(schemaText);
  });

  test("buildPrompt applies a configurable cap to base, instructions and sections", async () => {
    const cwd = await tempProject();
    try {
      await writeFile(join(cwd, "AGENTS.md"), "# Rules\nPROJECT RULE");
      const built = await buildPrompt(cwd, {
        instructions: locations({ project: [join(cwd, "AGENTS.md")] }),
        sections: [{ id: "skills", text: "S".repeat(100_000) }],
        maxPromptTokens: 1_200,
      });

      expect(built.system).toContain("PROJECT RULE");
      expect(built.system).toContain("prompt budget omitted: skills");
      expect(built.budget.omitted).toContain("skills");
      expect(
        (await buildSystemPrompt(cwd, ["one"], { instructions: locations() })).length,
      ).toBeGreaterThan(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("prompt stamp", () => {
  const tool = { name: "read", description: "read a file", parameters: { type: "object" } };

  test("names the exact prompt: whitespace keeps the version, tool schemas change the hash", async () => {
    const cwd = await tempProject();
    try {
      const plain = await buildPrompt(cwd, { instructions: locations(), sections: ["A  rule"] });
      const spaced = await buildPrompt(cwd, { instructions: locations(), sections: ["A rule\n"] });
      const withTools = await buildPrompt(cwd, {
        instructions: locations(),
        sections: ["A  rule"],
        tools: [tool],
      });
      const changedSchema = await buildPrompt(cwd, {
        instructions: locations(),
        sections: ["A  rule"],
        tools: [
          { ...tool, parameters: { type: "object", properties: { path: { type: "string" } } } },
        ],
      });

      expect(spaced.version).toBe(plain.version);
      expect(withTools.version).toBe(plain.version);
      expect(withTools.hash).not.toBe(plain.hash);
      expect(changedSchema.version).toBe(withTools.version);
      expect(changedSchema.hash).not.toBe(withTools.hash);
      expect(plain.base).toMatch(/^base-[0-9a-f]{12}$/);
      expect(plain.version).toMatch(/^v1-[0-9a-f]{16}$/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("records size and cuts per part, so a run shows what the model did not see", async () => {
    const cwd = await tempProject();
    try {
      for (const text of [
        "S".repeat(100_000),
        "S\n".repeat(30_000),
        "const x = [1];\n".repeat(8_000),
      ]) {
        const built = await buildPrompt(cwd, {
          instructions: locations(),
          sections: [{ id: "skills", text }],
          maxPromptTokens: 4_000,
        });
        const stamp = promptStamp(built, 4_000);
        expect(stamp.maxTokens).toBe(4_000);
        expect(stamp.parts.find((part) => part.id === "skills")?.trimmed).toBe(true);
        expect(stamp.overBudget).toBe(false);
        expect(stamp.tokens).toBeLessThanOrEqual(4_000);
        expect(stamp.tokens).toBeGreaterThan(3_000);
      }
      const tight = promptStamp(
        await buildPrompt(cwd, { instructions: locations(), maxPromptTokens: 500 }),
        500,
      );
      expect(tight.overBudget).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("the default budget keeps a large AGENTS.md whole", async () => {
    const cwd = await tempProject();
    try {
      const rules = Array.from({ length: 600 }, (_, index) => `- rule ${index}: keep it`).join(
        "\n",
      );
      await writeFile(join(cwd, "AGENTS.md"), `# Rules\n${rules}\nLAST RULE`);
      const built = await buildPrompt(cwd, {
        instructions: locations({ project: [join(cwd, "AGENTS.md")] }),
      });
      expect(built.system).toContain("LAST RULE");
      expect(built.budget.trimmed).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
