import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBubblewrapArgs,
  buildSeatbeltProfile,
  detectSandbox,
  type RunSandboxOptions,
  type RunSandboxResult,
  type SandboxDetection,
} from "../../src/security/os-sandbox";
import {
  SandboxUnsupportedError,
  type TerminalSandboxPolicy,
  TerminalSession,
  wrapShellCommand,
} from "../../src/terminal/session";
import { type BashSandboxDeps, runBash } from "../../src/tools/bash/run";
import type { OsSandboxContext, ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const sessions: TerminalSession[] = [];

const LIMITS = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

const BWRAP: SandboxDetection = {
  kind: "bubblewrap",
  command: "/usr/bin/bwrap",
  reason: "bwrap found",
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-os-sandbox-integration-"));
  dirs.push(dir);
  return dir;
}

function sandboxPolicy(overrides: Partial<OsSandboxContext> = {}): OsSandboxContext {
  return {
    enabled: true,
    allowNetwork: false,
    workspaceRoot: "/work/project",
    envAllowlist: ["PATH", "HOME"],
    writablePaths: ["/work/cache"],
    readOnlyPaths: ["/work/shared"],
    ...overrides,
  };
}

function context(
  cwd: string,
  options: { osSandbox?: OsSandboxContext; signal?: AbortSignal } = {},
): ToolContext {
  return {
    sessionId: "s_os_sandbox",
    cwd,
    signal: options.signal ?? new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits: LIMITS,
    reads: new ReadTracker(),
    ...(options.osSandbox ? { osSandbox: options.osSandbox } : {}),
  };
}

function deps(
  detection: SandboxDetection,
  run: (options: RunSandboxOptions) => Promise<RunSandboxResult>,
): BashSandboxDeps {
  return { detect: () => detection, run };
}

async function waitForText(
  session: TerminalSession,
  text: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.snapshot().plainText.includes(text)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bash os sandbox", () => {
  test("runs unsandboxed and reports sandboxed false without a policy", async () => {
    const result = await runBash({ command: "printf hi" }, context(await tempDir()));

    expect(result.ok).toBe(true);
    expect(result.output).toBe("hi");
    expect(result.data).toMatchObject({ kind: "terminal", sandboxed: false, exitCode: 0 });
  });

  test("delegates to the sandbox with the policy from the context", async () => {
    const cwd = await tempDir();
    const policy = sandboxPolicy();
    let received: RunSandboxOptions | undefined;
    const sandbox = deps(BWRAP, async (options) => {
      received = options;
      return { supported: true, exitCode: 0, output: "sandboxed output\n" };
    });

    const result = await runBash(
      { command: "printf hi", timeoutMs: 5000 },
      context(cwd, { osSandbox: policy }),
      sandbox,
    );

    expect(received?.command).toBe("bash");
    expect(received?.args).toEqual(["-lc", "printf hi"]);
    expect(received?.cwd).toBe(cwd);
    expect(received?.workspaceRoot).toBe(policy.workspaceRoot);
    expect(received?.allowNetwork).toBe(false);
    expect(received?.envAllowlist).toEqual(policy.envAllowlist);
    expect(received?.writablePaths).toEqual(["/work/cache"]);
    expect(received?.readOnlyPaths).toEqual(["/work/shared"]);
    expect(received?.detection?.kind).toBe("bubblewrap");
    expect(result.ok).toBe(true);
    expect(result.output).toBe("sandboxed output");
    expect(result.data).toMatchObject({ sandboxed: true, exitCode: 0, truncated: false });
  });

  test("forwards the environment allowlist unchanged", async () => {
    const allowed = ["PATH", "LANG"];
    let received: RunSandboxOptions | undefined;
    const sandbox = deps(BWRAP, async (options) => {
      received = options;
      return { supported: true, exitCode: 0, output: "ok" };
    });

    await runBash(
      { command: "true" },
      context(await tempDir(), { osSandbox: sandboxPolicy({ envAllowlist: allowed }) }),
      sandbox,
    );

    expect(received?.envAllowlist).toEqual(allowed);
  });

  test("fails instead of falling back when no OS sandbox is detected", async () => {
    let called = false;
    const sandbox = deps({ kind: "none", reason: "bwrap not found" }, async () => {
      called = true;
      return { supported: true, exitCode: 0, output: "" };
    });

    const result = await runBash(
      { command: "printf hi" },
      context(await tempDir(), { osSandbox: sandboxPolicy() }),
      sandbox,
    );

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("bwrap not found");
    expect(result.data).toMatchObject({ sandboxed: false, exitCode: null });
  });

  test("fails instead of falling back when the runner is not supported", async () => {
    const sandbox = deps(BWRAP, async () => ({
      supported: false,
      exitCode: null,
      output: "",
      reason: "spawn denied",
    }));

    const result = await runBash(
      { command: "printf hi" },
      context(await tempDir(), { osSandbox: sandboxPolicy() }),
      sandbox,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("spawn denied");
    expect(result.data).toMatchObject({ sandboxed: false });
  });

  test("keeps the timeout contract for sandboxed commands", async () => {
    let aborted = false;
    const sandbox = deps(
      BWRAP,
      (options) =>
        new Promise((resolve) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve({ supported: true, exitCode: 130, output: "partial" });
            },
            { once: true },
          );
          if (options.signal?.aborted) {
            aborted = true;
            resolve({ supported: true, exitCode: 130, output: "partial" });
          }
        }),
    );

    const result = await runBash(
      { command: "sleep 30", timeoutMs: 20 },
      context(await tempDir(), { osSandbox: sandboxPolicy() }),
      sandbox,
    );

    expect(aborted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
    expect(result.data).toMatchObject({ sandboxed: true, timedOut: true, exitCode: 124 });
  });

  test("keeps the abort contract for sandboxed commands", async () => {
    const controller = new AbortController();
    const sandbox = deps(
      BWRAP,
      (options) =>
        new Promise((resolve) => {
          const done = () => resolve({ supported: true, exitCode: 130, output: "" });
          options.signal?.addEventListener("abort", done, { once: true });
          if (options.signal?.aborted) done();
        }),
    );

    const result = runBash(
      { command: "sleep 30" },
      context(await tempDir(), { osSandbox: sandboxPolicy(), signal: controller.signal }),
      sandbox,
    );
    controller.abort();

    expect(await result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Command aborted"),
      data: { sandboxed: true, aborted: true, exitCode: 130 },
    });
  });
});

describe("terminal sandbox argv", () => {
  const policy: TerminalSandboxPolicy & { cwd: string } = {
    ...sandboxPolicy(),
    cwd: "/work/project/src",
  };

  test("wraps the shell exactly as bubblewrap documents", () => {
    const wrapped = wrapShellCommand("/bin/bash", ["-i", "+m"], policy, BWRAP);

    expect(wrapped.supported).toBe(true);
    if (!wrapped.supported) return;
    expect(wrapped.command).toEqual([
      "/usr/bin/bwrap",
      ...buildBubblewrapArgs({ ...policy, command: "/bin/bash", args: ["-i", "+m"] }),
    ]);
    expect(wrapped.command).toContain("--unshare-net");
    expect(wrapped.command.slice(-4)).toEqual(["--", "/bin/bash", "-i", "+m"]);
  });

  test("wraps the shell exactly as seatbelt documents", () => {
    const wrapped = wrapShellCommand("/bin/bash", ["-i"], policy, {
      kind: "seatbelt",
      command: "/usr/bin/sandbox-exec",
      reason: "sandbox-exec found",
    });

    expect(wrapped.supported).toBe(true);
    if (!wrapped.supported) return;
    expect(wrapped.command).toEqual([
      "/usr/bin/sandbox-exec",
      "-p",
      buildSeatbeltProfile(policy),
      "/bin/bash",
      "-i",
    ]);
  });

  test("reports unsupported detection as a typed reason", () => {
    const wrapped = wrapShellCommand("/bin/bash", ["-i"], policy, {
      kind: "none",
      reason: "no sandbox",
    });

    expect(wrapped).toEqual({ supported: false, reason: "no sandbox" });
  });

  test("start returns a typed error instead of running unsandboxed", async () => {
    const session = new TerminalSession("sandboxed");
    sessions.push(session);

    const error = session.start(
      { cwd: await tempDir(), sandbox: sandboxPolicy() },
      { kind: "none", reason: "no bwrap" },
    );

    expect(error).toBeInstanceOf(SandboxUnsupportedError);
    expect(error?.code).toBe("sandbox_unsupported");
    expect(error?.message).toContain("no bwrap");
    expect(session.snapshot().running).toBe(false);
  });

  test.skipIf(detectSandbox().kind !== "bubblewrap")(
    "runs an interactive shell inside bubblewrap",
    async () => {
      const cwd = await tempDir();
      const session = new TerminalSession("bubblewrap");
      sessions.push(session);

      const error = session.start({
        cwd,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd },
        sandbox: {
          enabled: true,
          allowNetwork: false,
          workspaceRoot: cwd,
          envAllowlist: ["PATH", "HOME"],
        },
      });
      expect(error).toBeNull();

      session.write("printf 'SANDBOX_%s\\n' OK\n");
      await waitForText(session, "SANDBOX_OK");
    },
  );
});
