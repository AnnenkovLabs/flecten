import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../../src/config/load";
import { saveSecrets, secretsPath, setSecretBackend } from "../../src/config/secrets";
import { atomicWrite } from "../../src/util/atomic";

const dirs: string[] = [];
const savedConfig = process.env.FLECTEN_CONFIG;
const supportsPosixModes = process.platform !== "win32";
let umask = 0;

beforeEach(() => {
  setSecretBackend("file");
  delete process.env.FLECTEN_CONFIG;
  umask = process.umask(0o022);
});

afterEach(async () => {
  process.umask(umask);
  if (savedConfig === undefined) delete process.env.FLECTEN_CONFIG;
  else process.env.FLECTEN_CONFIG = savedConfig;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-config-save-"));
  dirs.push(dir);
  return dir;
}

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe("config and secret writes", () => {
  test("a symlinked config keeps its link and the target gets the new content", async () => {
    const cwd = await tempDir();
    const dotfiles = await tempDir();
    const target = join(dotfiles, "liquid.json");
    const link = join(cwd, "flecten.config.json");
    const config = await loadConfig(cwd);
    await writeFile(target, `${JSON.stringify(config)}\n`);
    await symlink(target, link);

    await saveConfig(cwd, { ...config, provider: config.provider }, { path: link });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await Bun.file(target).text()).toContain('"schemaVersion"');
    if (supportsPosixModes) expect(await mode(target)).toBe(0o600);
    expect((await readdir(dotfiles)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("secret replacement preserves content and private POSIX permissions", async () => {
    const cwd = await tempDir();
    await saveSecrets(cwd, { openai: "sk-test-1" });
    expect(await Bun.file(secretsPath(cwd)).json()).toEqual({ openai: "sk-test-1" });
    if (supportsPosixModes) expect(await mode(secretsPath(cwd))).toBe(0o600);
    await saveSecrets(cwd, { openai: "sk-test-2" });
    if (supportsPosixModes) expect(await mode(secretsPath(cwd))).toBe(0o600);
    expect(await Bun.file(secretsPath(cwd)).json()).toEqual({ openai: "sk-test-2" });
  });

  test("a failed write leaves the old file whole and no temp files", async () => {
    const dir = await tempDir();
    const path = join(dir, "state.json");
    await atomicWrite(path, "old");
    await expect(atomicWrite(join(path, "child"), "x")).rejects.toThrow();
    expect(await Bun.file(path).text()).toBe("old");
    expect((await readdir(dir)).sort()).toEqual(["state.json"]);
    await atomicWrite(join(dir, "nested", "deep", "file.json"), "{}", 0o600);
    expect(await Bun.file(join(dir, "nested", "deep", "file.json")).text()).toBe("{}");
    if (supportsPosixModes)
      expect(await mode(join(dir, "nested", "deep", "file.json"))).toBe(0o600);
  });
});
