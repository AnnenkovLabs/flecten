import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { permissionRequest } from "../../src/core/loop/permission-request";
import { buildSeatbeltProfile } from "../../src/security/os-sandbox";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { applyPatchTool, runApplyPatch } from "../../src/tools/apply-patch/run";
import { runDelete } from "../../src/tools/delete/run";
import { runMove } from "../../src/tools/move/run";
import type { ToolContext } from "../../src/tools/types";
import { displayPath, isInside } from "../../src/tools/util/paths";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("workspace aliases allow their own files while canonical permission and symlink escapes stay denied", async () => {
  const base = await mkdtemp(join(tmpdir(), "flecten-workspace-alias-"));
  directories.push(base);
  const root = join(base, "project");
  const cwd = join(base, "alias");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await symlink(root, cwd, process.platform === "win32" ? "junction" : "dir");
  const canonical = await realpath(root);
  await symlink(outside, join(cwd, "escape"), process.platform === "win32" ? "junction" : "dir");
  const sandbox = new SandboxPolicy({ workspaceRoot: cwd });
  const context: ToolContext = {
    cwd,
    sessionId: "alias",
    signal: new AbortController().signal,
    reads: new ReadTracker(),
    sandbox,
    logDir: join(cwd, "logs"),
    limits: { maxOutputBytes: 5000, maxOutputLines: 100, bashTimeoutMs: 1000, readLimitLines: 100 },
  };
  expect(isInside(cwd, join(canonical, "new.txt"))).toBe(true);
  expect(displayPath(cwd, join(canonical, "new.txt"))).toBe("new.txt");
  expect((await sandbox.checkWrite("new.txt")).allowed).toBe(true);
  expect((await sandbox.checkWrite(join(canonical, "new.txt"))).allowed).toBe(true);
  expect((await sandbox.checkWrite(".git/config")).allowed).toBe(false);
  const patch = "*** Begin Patch\n*** Add File: new.txt\n+content\n*** End Patch";
  expect((await runApplyPatch({ patch }, context)).ok).toBe(true);
  expect(await readFile(join(root, "new.txt"), "utf8")).toBe("content");
  expect((await runMove({ from: "new.txt", to: "moved.txt" }, context)).ok).toBe(true);
  expect((await runDelete({ path: "moved.txt" }, context)).ok).toBe(true);
  const request = await permissionRequest(
    { id: "patch", name: "apply_patch", args: { patch } },
    applyPatchTool,
    context,
  );
  expect(request?.safety).toBe("bounded");
  await mkdir(join(cwd, "private"));
  await writeFile(join(cwd, "private", "secret.txt"), "secret");
  const permissions = new PermissionEngine({
    rules: [
      { action: "read", policy: "allow" },
      { action: "read", pathPrefix: "private", policy: "deny" },
    ],
  });
  expect(
    permissions.check({
      action: "read",
      tool: "read",
      cwd,
      path: join(canonical, "private", "secret.txt"),
    }).policy,
  ).toBe("deny");
  expect((await sandbox.checkRead("escape/secret.txt")).allowed).toBe(false);
  expect(
    (await runApplyPatch({ patch: patch.replace("new.txt", "escape/new.txt") }, context)).ok,
  ).toBe(false);
  await expect(readFile(join(outside, "new.txt"))).rejects.toThrow();
  const profile = buildSeatbeltProfile({ workspaceRoot: cwd, cwd, allowNetwork: false });
  expect(profile).toContain(`(subpath ${JSON.stringify(canonical)})`);
  const paths = sessionPaths(cwd, "alias");
  const file = await pageSink(paths).write(1, "# Summary", "original transcript");
  if (!file) throw new Error("Page archive did not return its saved path");
  expect(file).toBe(join(paths.pages, "1.md"));
  expect(await readFile(file, "utf8")).toBe("# Summary");
});
