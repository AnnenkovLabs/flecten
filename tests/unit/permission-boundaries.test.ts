import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { osSandboxFor } from "../../src/app/service-policy";
import { HarnessConfigSchema } from "../../src/config/schema";
import {
  buildBubblewrapArgs,
  buildSeatbeltProfile,
  detectSandbox,
  runSandboxed,
} from "../../src/security/os-sandbox";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import { runGlob } from "../../src/tools/glob/run";
import { runGrep } from "../../src/tools/grep/run";

const dirs: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "flecten-permission-boundary-"));
  dirs.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("resource boundaries", () => {
  test("search from a parent cannot expose denied descendants, secrets or symlink targets", async () => {
    const cwd = await directory();
    await mkdir(join(cwd, "private"));
    await writeFile(join(cwd, "public.txt"), "needle public");
    await writeFile(join(cwd, "private", "secret.txt"), "needle denied");
    await writeFile(join(cwd, ".env"), "needle token");
    await symlink(join(cwd, "private", "secret.txt"), join(cwd, "alias.txt"));
    const context = {
      cwd,
      signal: new AbortController().signal,
      sandbox: new SandboxPolicy({ workspaceRoot: cwd }),
      permissions: new PermissionEngine({
        rules: [
          { action: "read", policy: "auto" },
          { action: "read", pathPrefix: "private", policy: "deny" },
        ],
      }),
    };
    const grep = await runGrep({ pattern: "needle", literal: true, hidden: true }, context);
    expect(grep.ok).toBe(true);
    expect(grep.output).toContain("public");
    expect(grep.output).not.toContain("denied");
    expect(grep.output).not.toContain("token");
    const glob = await runGlob({ pattern: "*", hidden: true }, context);
    expect(glob.output).toContain("public.txt");
    expect(glob.output).not.toContain("secret.txt");
    expect(glob.output).not.toContain("alias.txt");
    expect(glob.output).not.toContain(".env");
  });
  test("native sandbox protects control files and masks configured secret paths", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "AGENTS.md"), "instructions");
    await writeFile(join(cwd, ".env"), "private");
    const secret = join(cwd, "private-data");
    await mkdir(secret);
    const options = {
      workspaceRoot: cwd,
      cwd,
      allowNetwork: false,
      command: "bash",
      args: ["-lc", "true"],
      readDeniedPaths: [secret],
    };
    const argv = buildBubblewrapArgs(options);
    expect(argv.join("\n")).toContain(
      ["--ro-bind", join(cwd, "AGENTS.md"), join(cwd, "AGENTS.md")].join("\n"),
    );
    expect(argv.join("\n")).toContain(["--ro-bind", "/dev/null", join(cwd, ".env")].join("\n"));
    expect(argv.join("\n")).toContain(["--tmpfs", secret, "--remount-ro", secret].join("\n"));
    const profile = buildSeatbeltProfile(options);
    expect(profile).toContain("(deny file-read*");
    expect(profile).toContain(`(subpath ${JSON.stringify(join(cwd, ".env"))})`);
    expect(await readFile(join(cwd, ".env"), "utf8")).toBe("private");
  });
  test("protected symlinks protect both their logical name and resolved target", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, "ordinary.txt"), "instructions");
    await symlink(join(cwd, "ordinary.txt"), join(cwd, "AGENTS.md"));
    const sandbox = new SandboxPolicy({ workspaceRoot: cwd });
    expect((await sandbox.checkWrite("AGENTS.md")).allowed).toBe(false);
    expect((await sandbox.checkWrite("ordinary.txt")).allowed).toBe(false);
    const elsewhere = join(cwd, "elsewhere.txt");
    await writeFile(elsewhere, "different");
    await rm(join(cwd, "AGENTS.md"));
    await symlink(elsewhere, join(cwd, "AGENTS.md"));
    expect((await sandbox.checkWrite("elsewhere.txt")).allowed).toBe(false);
    expect((await sandbox.checkWrite("ordinary.txt")).allowed).toBe(true);
  });
  test.skipIf(detectSandbox().kind === "none")(
    "native process respects file deny rules, control files and secret symlinks",
    async () => {
      const cwd = await directory();
      await mkdir(join(cwd, "private"));
      await writeFile(join(cwd, "private", "secret.txt"), "private-value");
      await writeFile(join(cwd, "public-secret.txt"), "secret-value");
      await symlink(join(cwd, "public-secret.txt"), join(cwd, ".env"));
      await writeFile(join(cwd, "AGENTS.md"), "original");
      const config = HarnessConfigSchema.parse({
        permissions: { rules: [{ action: "read", policy: "deny", pathPrefix: "private" }] },
      });
      const boundary = osSandboxFor(config, cwd);
      if (!boundary) throw new Error("Expected enabled native boundary");
      const result = await runSandboxed({
        ...boundary,
        workspaceRoot: cwd,
        cwd,
        allowNetwork: false,
        command: "/bin/sh",
        args: [
          "-c",
          "printf okay > normal.txt; cat private/secret.txt; cat public-secret.txt; printf changed > AGENTS.md",
        ],
        timeoutMs: 5000,
      });
      expect(result.supported).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).not.toContain("private-value");
      expect(result.output).not.toContain("secret-value");
      expect(await readFile(join(cwd, "normal.txt"), "utf8")).toBe("okay");
      expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe("original");
    },
  );
});
