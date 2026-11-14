import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModulesConfigSchema } from "../../src/config/modules";
import { mcpMedia } from "../../src/mcp/media";
import { ModuleCatalog } from "../../src/modules/catalog";
import { installModule, readModule } from "../../src/modules/package";
import { resolveModules } from "../../src/modules/resolve";
import { waitFor } from "../helpers/hooks";

const directories: string[] = [];
const catalogs: ModuleCatalog[] = [];
afterEach(async () => {
  for (const catalog of catalogs.splice(0)) catalog.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "module-validation-"));
  directories.push(cwd);
  return cwd;
}
async function pack(root: string, name: string, extras: Record<string, unknown> = {}) {
  await mkdir(join(root, ".flecten-module"), { recursive: true });
  await Bun.write(
    join(root, ".flecten-module/module.json"),
    JSON.stringify({ schemaVersion: 1, name, description: name, version: "1", ...extras }),
  );
}

test("installation copies reviewed bytes, refuses existing targets and rejects escaping resources and symlinks", async () => {
  const cwd = await workspace();
  const source = await workspace();
  await pack(source, "example", { instructions: ["instructions.md"] });
  await Bun.write(join(source, "instructions.md"), "reviewed instructions");
  const reviewed = await readModule(source);
  const installed = await installModule(cwd, source);
  expect((await readModule(installed)).revision).toBe(reviewed.revision);
  await Bun.write(join(source, "instructions.md"), "new unreviewed bytes");
  await expect(installModule(cwd, source)).rejects.toThrow();
  expect((await readModule(installed)).revision).toBe(reviewed.revision);
  await pack(source, "example", {
    resources: [{ id: "escape", path: "../secret", description: "Escape" }],
  });
  await expect(readModule(source)).rejects.toThrow("relative path");
  await pack(source, "example");
  await symlink(join(installed, "instructions.md"), join(source, "symlink.md"));
  await expect(readModule(source)).rejects.toThrow("regular files");
});

test("dependency cycles, duplicate identities and unknown manifest fields fail closed", async () => {
  const cwd = await workspace();
  const root = join(cwd, ".agents/modules");
  const a = join(root, "a");
  const b = join(root, "b");
  await pack(a, "a", { requires: ["b"] });
  await pack(b, "b", { requires: ["a"] });
  const config = ModulesConfigSchema.parse({ development: [a, b] });
  const catalog = new ModuleCatalog(cwd, () => config);
  catalogs.push(catalog);
  await catalog.refresh();
  expect(() => resolveModules(catalog, ["a"])).toThrow("cycle");
  await pack(b, "a");
  await catalog.refresh(true);
  expect(catalog.modules.has("a")).toBe(false);
  expect(catalog.errors.some((error) => error.message.includes("Duplicate module name"))).toBe(
    true,
  );
  await pack(a, "a", { instruction: ["typo.md"] });
  await expect(readModule(a)).rejects.toThrow("Unrecognized key");
});

test("watch discovers new modules and file revisions without a forced reload", async () => {
  const cwd = await workspace();
  const catalog = new ModuleCatalog(cwd, () => ModulesConfigSchema.parse({}));
  catalogs.push(catalog);
  await catalog.refresh();
  const root = join(cwd, ".agents/modules/watched");
  await pack(root, "watched");
  await waitFor(async () => {
    await catalog.refresh();
    return catalog.modules.has("watched");
  }, 12_000);
  const revision = catalog.modules.get("watched")?.revision;
  await Bun.write(join(root, "new.md"), "new bytes");
  await waitFor(async () => {
    await catalog.refresh();
    return catalog.modules.get("watched")?.revision !== revision;
  }, 12_000);
  expect(catalog.modules.get("watched")?.revision).not.toBe(revision);
}, 30_000);

test("MCP media rejects invalid base64, MIME confusion and too many attachments at the boundary", () => {
  expect(() => mcpMedia([{ type: "image", mimeType: "image/png", data: "bad base64!" }])).toThrow(
    "base64",
  );
  expect(() => mcpMedia([{ type: "image", mimeType: "audio/wav", data: "eA==" }])).toThrow("MIME");
  expect(() => mcpMedia(Array.from({ length: 6 }, () => ({ type: "image" })))).toThrow(
    "more than 5",
  );
});
