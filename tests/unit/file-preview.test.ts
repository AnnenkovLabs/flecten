import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREVIEW_BYTES, previewFile } from "../../src/app/file-preview";

async function withProject(run: (cwd: string, outside: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-preview-"));
  const outside = await mkdtemp(join(tmpdir(), "liquid-outside-"));
  try {
    await run(cwd, outside);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

describe("file preview", () => {
  test("shows a project file and a tool log with secrets masked", async () => {
    await withProject(async (cwd) => {
      await mkdir(join(cwd, ".liquid/sessions/s1/logs"), { recursive: true });
      const log = join(cwd, ".liquid/sessions/s1/logs/bash-1.log");
      await writeFile(log, "token ghp_abcdefghijklmnopqrstuvwxyz0123456789\nok\n");
      const file = await previewFile(cwd, log);
      expect(file.path).toBe(".liquid/sessions/s1/logs/bash-1.log");
      expect(file.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
      expect(file.text).toContain("ok");
      expect(file.truncated).toBe(false);

      await writeFile(join(cwd, "a.ts"), "\uFEFFexport const a = 1;\n");
      const source = await previewFile(cwd, "a.ts");
      expect(source.text).toBe("export const a = 1;\n");
    });
  });

  test("refuses paths and links that lead outside the project", async () => {
    await withProject(async (cwd, outside) => {
      await writeFile(join(outside, "secret.txt"), "nope\n");
      await symlink(join(outside, "secret.txt"), join(cwd, "link.txt"));
      await expect(previewFile(cwd, join(outside, "secret.txt"))).rejects.toThrow("outside");
      await expect(previewFile(cwd, "../secret.txt")).rejects.toThrow();
      await expect(previewFile(cwd, "link.txt")).rejects.toThrow("outside");
      await expect(previewFile(cwd, "missing.txt")).rejects.toThrow("not found");
      await mkdir(join(cwd, "dir"));
      await expect(previewFile(cwd, "dir")).rejects.toThrow("not a regular file");
    });
  });

  test("cuts a large file on a line break and flags binary files", async () => {
    await withProject(async (cwd) => {
      const line = `${"x".repeat(99)}\n`;
      await writeFile(join(cwd, "big.log"), line.repeat(Math.ceil((PREVIEW_BYTES * 2) / 100)));
      const big = await previewFile(cwd, "big.log");
      expect(big.truncated).toBe(true);
      expect(big.text.length).toBeLessThanOrEqual(PREVIEW_BYTES);
      expect(big.text.endsWith("\n")).toBe(true);

      await writeFile(join(cwd, "image.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
      const image = await previewFile(cwd, "image.png");
      expect(image.binary).toBe(true);
      expect(image.text).toBe("");
    });
  });
});
