import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProjectFile } from "../../src/app/file-edit";
import { PREVIEW_BYTES, previewFile } from "../../src/app/file-preview";
import { createHandlers } from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";

async function project(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-ide-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("IDE file saves", () => {
  test("real sidecar handlers read and save an empty UTF-8 file preserving BOM and executable mode", async () => {
    await project(async (cwd) => {
      await writeFile(join(cwd, "run.sh"), "\uFEFFecho hello\r\n");
      await chmod(join(cwd, "run.sh"), 0o755);
      const app = { info: () => ({ cwd }) } as unknown as AppService;
      const handlers = createHandlers(app, () => undefined);
      const opened = await handlers["files.read"]({ type: "files.read", path: "run.sh" });
      const file = opened?.file as Awaited<ReturnType<typeof previewFile>>;
      expect(file.text).toBe("echo hello\r\n");
      expect(file.hash).toHaveLength(64);
      const saved = await handlers["files.write"]({
        type: "files.write",
        path: "run.sh",
        text: "",
        expectedHash: file.hash,
      });
      expect(saved).toMatchObject({ file: { text: "" } });
      expect(await readFile(join(cwd, "run.sh"), "utf8")).toBe("\uFEFF");
      expect((await stat(join(cwd, "run.sh"))).mode & 0o777).toBe(0o755);
    });
  });

  test("rejects stale editor content and serializes simultaneous saves", async () => {
    await project(async (cwd) => {
      const path = join(cwd, "a.ts");
      await writeFile(path, "one\n");
      const before = await previewFile(cwd, "a.ts");
      await writeFile(path, "agent change\n");
      await expect(
        saveProjectFile(cwd, {
          path: "a.ts",
          text: "stale\n",
          expectedHash: before.hash,
        }),
      ).rejects.toThrow("изменился на диске");
      expect(await readFile(path, "utf8")).toBe("agent change\n");
      const current = await previewFile(cwd, "a.ts");
      const saves = await Promise.allSettled(
        ["first\n", "second\n"].map((text) =>
          saveProjectFile(cwd, { path: "a.ts", text, expectedHash: current.hash }),
        ),
      );
      expect(saves.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(saves.filter((result) => result.status === "rejected")).toHaveLength(1);
    });
  });

  test("never saves redacted, binary, truncated, invalid UTF-8 or internal files", async () => {
    await project(async (cwd) => {
      await mkdir(join(cwd, ".liquid"));
      const cases: Array<[string, string | Uint8Array]> = [
        ["secret.txt", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n"],
        ["binary.dat", new Uint8Array([1, 0, 2])],
        ["invalid.txt", new Uint8Array([0xff, 0xfa])],
        ["utf16.txt", new Uint8Array([0xff, 0xfe, 65, 0])],
        ["large.txt", "x".repeat(PREVIEW_BYTES + 1)],
        [".liquid/log.txt", "internal\n"],
      ];
      for (const [path, text] of cases) {
        await writeFile(join(cwd, path), text);
        const file = await previewFile(cwd, path);
        expect(file.hash).toBeUndefined();
        expect(file.readOnlyReason).toBeTruthy();
        await expect(
          saveProjectFile(cwd, {
            path,
            text: "changed",
            expectedHash: "0".repeat(64),
          }),
        ).rejects.toThrow();
        expect(await readFile(join(cwd, path))).toEqual(Buffer.from(text));
      }
    });
  });

  test("validates commands and refuses outside symlinks before any write", async () => {
    await project(async (cwd) => {
      await project(async (outside) => {
        const path = join(outside, "outside.txt");
        await writeFile(path, "safe");
        await symlink(path, join(cwd, "link.txt"));
        await expect(
          saveProjectFile(cwd, {
            path: "link.txt",
            text: "no",
            expectedHash: "0".repeat(64),
          }),
        ).rejects.toThrow("вне проекта");
        expect(await readFile(path, "utf8")).toBe("safe");
      });
      await expect(
        saveProjectFile(cwd, {
          path: "a.ts",
          text: 7,
          expectedHash: "0".repeat(64),
        }),
      ).rejects.toThrow("Invalid file save");
      await expect(
        saveProjectFile(cwd, {
          path: "a.ts",
          text: "",
          expectedHash: "wrong",
        }),
      ).rejects.toThrow("Invalid file save");
      await expect(
        saveProjectFile(cwd, {
          path: "a.ts",
          text: "я".repeat(PREVIEW_BYTES),
          expectedHash: "0".repeat(64),
        }),
      ).rejects.toThrow("512 КБ");
    });
  });
});
