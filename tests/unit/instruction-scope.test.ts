import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstructions } from "../../src/context/instructions";
import { buildPrompt } from "../../src/core/prompt";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "flecten-instruction-scope-"));
  roots.push(root);
  return root;
}

test("opening a parent directory does not preload instructions from unrelated projects", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, "AGENTS.md"), "ROOT_RULE");
  for (let index = 0; index < 8; index += 1) {
    const project = join(cwd, `project-${index}`);
    await mkdir(project);
    await writeFile(
      join(project, "AGENTS.md"),
      `UNRELATED_PROJECT_${index}\n${"x".repeat(20_000)}`,
    );
  }
  for (const role of [undefined, "talker", "worker"] as const) {
    const built = await buildPrompt(cwd, {
      instructions: { managed: [], user: [] },
      ...(role ? { role } : {}),
    });
    expect(built.instructions.sources.map((source) => source.kind)).toEqual(["project"]);
    expect(built.system).toContain("ROOT_RULE");
    expect(built.system).toContain("Read nested instructions only for the files you work with");
    expect(built.system).not.toContain("UNRELATED_PROJECT_");
    expect(built.budget.overBudget).toBe(false);
  }
});

test("explicit nested preloading has a shared byte budget and reports deferred rules", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, "AGENTS.md"), `ROOT_RULE\n${"x".repeat(32_000)}`);
  for (let index = 0; index < 4; index += 1) {
    const project = join(cwd, `project-${index}`);
    await mkdir(project);
    await writeFile(join(project, "AGENTS.md"), `NESTED_RULE_${index}\n${"x".repeat(20_000)}`);
  }
  const bundle = await loadInstructions(cwd, { managed: [], user: [], nested: true });
  expect(bundle.sources.filter((source) => source.kind === "nested")).toHaveLength(1);
  expect(Buffer.byteLength(bundle.text)).toBeLessThan(66_000);
  expect(bundle.text).toContain("Nested instruction preload reached its limit");
  expect(bundle.text).toContain("ROOT_RULE");
});

test("oversized required instructions fail explicitly before filling the model context", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, "AGENTS.md"), "x".repeat(100_000));
  await expect(buildPrompt(cwd, { instructions: { managed: [], user: [] } })).rejects.toThrow(
    "Instruction sources exceed the 65536-byte startup budget",
  );
});
