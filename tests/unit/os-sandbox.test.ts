import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildBubblewrapArgs,
  buildSeatbeltProfile,
  detectSandbox,
  runSandboxed,
  type SandboxCommandOptions,
} from "../../src/security/os-sandbox";

const dirs: string[] = [];

const POLICY = {
  workspaceRoot: "/work/project",
  cwd: "/work/project/src",
  allowNetwork: false,
  writablePaths: ["/work/cache"],
  readOnlyPaths: ["/work/shared"],
  envAllowlist: ["PATH"],
  command: "bash",
  args: ["-lc", "echo hello"],
} satisfies SandboxCommandOptions;

async function sandboxTempDir(): Promise<string> {
  const dir = await mkdtemp(join("/tmp", "liquid-os-sandbox-"));
  dirs.push(dir);
  return dir;
}

function hasBind(args: readonly string[], flag: string, path: string): boolean {
  return args.some(
    (argument, index) => argument === flag && args[index + 1] === path && args[index + 2] === path,
  );
}

function countBind(args: readonly string[], flag: string, path: string): number {
  return args.filter(
    (argument, index) => argument === flag && args[index + 1] === path && args[index + 2] === path,
  ).length;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("detectSandbox", () => {
  test("prefers bubblewrap on Linux", () => {
    const detection = detectSandbox({
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    });

    expect(detection).toEqual({
      kind: "bubblewrap",
      command: "/usr/bin/bwrap",
      reason: expect.stringContaining("bwrap"),
    });
  });

  test("falls back to none on Linux without bwrap", () => {
    const detection = detectSandbox({ platform: "linux", which: () => null });

    expect(detection.kind).toBe("none");
    expect(detection.command).toBeUndefined();
    expect(detection.reason).toContain("bwrap");
  });

  test("uses sandbox-exec on macOS", () => {
    const detection = detectSandbox({ platform: "darwin", exists: () => true });

    expect(detection).toEqual({
      kind: "seatbelt",
      command: "/usr/bin/sandbox-exec",
      reason: expect.stringContaining("sandbox-exec"),
    });
  });

  test("falls back to none on macOS without sandbox-exec", () => {
    const detection = detectSandbox({ platform: "darwin", exists: () => false });

    expect(detection.kind).toBe("none");
    expect(detection.reason).toContain("sandbox-exec");
  });

  test("falls back to none on unsupported platforms", () => {
    const detection = detectSandbox({ platform: "win32" });

    expect(detection.kind).toBe("none");
    expect(detection.reason).toContain("win32");
  });
});

describe("buildBubblewrapArgs", () => {
  test("builds the filesystem, namespace and cwd arguments", () => {
    const args = buildBubblewrapArgs(POLICY);

    expect(args.slice(0, 5)).toEqual(["--ro-bind", "/", "/", "--tmpfs", "/tmp"]);
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--proc");
    expect(args).toContain("--dev");
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--chdir");
    expect(
      args.some((argument, index) => argument === "--chdir" && args[index + 1] === POLICY.cwd),
    ).toBe(true);
    expect(hasBind(args, "--bind", POLICY.workspaceRoot)).toBe(true);
    expect(hasBind(args, "--bind", "/work/cache")).toBe(true);
    expect(hasBind(args, "--ro-bind", "/work/shared")).toBe(true);
    expect(args.slice(-4)).toEqual(["--", "bash", "-lc", "echo hello"]);
  });

  test("does not unshare the network when it is allowed", () => {
    const args = buildBubblewrapArgs({ ...POLICY, allowNetwork: true });

    expect(args).not.toContain("--unshare-net");
  });

  test("keeps writable paths unique and read-only paths last", () => {
    const args = buildBubblewrapArgs({
      ...POLICY,
      workspaceRoot: "/work/project",
      writablePaths: ["/work/project", "/work/cache"],
      readOnlyPaths: ["/work/project/docs"],
    });

    expect(countBind(args, "--bind", "/work/project")).toBe(1);
    expect(hasBind(args, "--ro-bind", "/work/project/docs")).toBe(true);
    expect(args.indexOf("/work/project/docs")).toBeGreaterThan(args.indexOf("/work/cache"));
  });

  test("passes command arguments without shell interpolation", () => {
    const args = buildBubblewrapArgs({
      ...POLICY,
      command: "printf",
      args: ["%s", "hello; rm -rf / $(whoami)"],
    });

    expect(args.slice(-4)).toEqual(["--", "printf", "%s", "hello; rm -rf / $(whoami)"]);
  });
});

describe("buildSeatbeltProfile", () => {
  test("denies network by default and allows the workspace", () => {
    const profile = buildSeatbeltProfile(POLICY);

    expect(profile).toContain("(version 1)");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("(allow network*)");
    expect(profile).toContain('(subpath "/usr/lib")');
    expect(profile).toContain('(subpath "/System")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain('(subpath "/work/project")');
    expect(profile).toContain('(subpath "/work/cache")');
    expect(profile).toContain('(subpath "/work/shared")');
  });

  test("allows network when it is enabled", () => {
    const profile = buildSeatbeltProfile({ ...POLICY, allowNetwork: true });

    expect(profile).toContain("(allow network*)");
    expect(profile).not.toContain("(deny network*)");
  });

  test("denies writes to read-only paths after the workspace allow", () => {
    const profile = buildSeatbeltProfile(POLICY);
    const denyStart = profile.indexOf("(deny file-write*");

    expect(denyStart).toBeGreaterThan(-1);
    expect(profile.slice(denyStart)).toContain('(subpath "/work/shared")');
    expect(profile.indexOf("(deny file-write*")).toBeGreaterThan(
      profile.indexOf("(allow file-write*"),
    );
  });

  test("escapes paths instead of interpolating raw scheme", () => {
    const workspaceRoot = '/work/pro"ject';
    const profile = buildSeatbeltProfile({ ...POLICY, workspaceRoot });

    expect(profile).toContain(`(subpath ${JSON.stringify(workspaceRoot)})`);
  });
});

describe("runSandboxed", () => {
  test("drains output while running and closes inherited pipes when the launcher exits", async () => {
    const root = await sandboxTempDir();
    const launcher = join(root, "test-sandbox");
    await writeFile(
      launcher,
      "#!/bin/sh\nhead -c 3000000 /dev/zero | tr '\\0' 'x'\nprintf tail >&2\nsleep 30 &\n",
      { mode: 0o700 },
    );
    const result = await runSandboxed({
      ...POLICY,
      workspaceRoot: root,
      cwd: root,
      detection: { kind: "bubblewrap", command: launcher, reason: "test launcher" },
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.reason).toBeUndefined();
    expect(result.output).toEndWith("[output truncated]");
    expect(Buffer.byteLength(result.output)).toBeLessThan(2 * 1024 * 1024 + 100);
  });

  test("returns unsupported without running the command", async () => {
    const result = await runSandboxed({
      ...POLICY,
      command: "/definitely/not/a/real/command",
      args: [],
      detection: { kind: "none", reason: "no sandbox here" },
    });

    expect(result).toEqual({
      supported: false,
      exitCode: null,
      output: "",
      reason: "no sandbox here",
    });
  });

  const detection = detectSandbox();

  test.skipIf(detection.kind === "none")(
    "runs a command inside the detected OS sandbox",
    async () => {
      const root = await sandboxTempDir();
      const result = await runSandboxed({
        workspaceRoot: root,
        cwd: root,
        allowNetwork: false,
        writablePaths: [],
        readOnlyPaths: [],
        envAllowlist: ["PATH"],
        command: "/bin/sh",
        args: ["-c", "printf sandbox-ok; printf data > marker.txt; pwd"],
        timeoutMs: 15_000,
      });

      expect(result.supported).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("sandbox-ok");
      expect(result.output).toContain(root);
      expect(await readFile(join(root, "marker.txt"), "utf8")).toBe("data");
    },
  );
});
