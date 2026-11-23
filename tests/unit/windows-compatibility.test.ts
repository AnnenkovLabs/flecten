import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  accessModes,
  activeAccessMode,
  applyAccessMode,
  defaultSandboxEnabled,
} from "../../shared/access-mode";
import { sameProjectPath } from "../../shared/project-index.cjs";
import { resolvePythonCommand } from "../../src/app/voice/local";
import { permissionPath } from "../../src/security/permission-request-key";
import { shellPaths } from "../../src/security/shell-paths";
import { gitBaseEnvironment } from "../../src/store/checkpoints/shadow-git";
import { commandWithCompletion } from "../../src/terminal/command-completion";
import { defaultTerminalEnvAllowlist } from "../../src/terminal/settings";
import { buildEnvironment, resolveShell, spawnCommandSpec } from "../../src/terminal/shell";
import { windowsReservedPathError } from "../../src/tools/util/paths";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { scratchEnvironment } from "../../src/tools/util/scratch";
import { baseName } from "../../ui/src/lib/agent";

const { parseSessionLink } = require("../../shell/deep-links.mjs") as {
  parseSessionLink(value: string): { id: string; project: string } | null;
};

const { buildSpawnSpec, resolveAgentLaunch, resolveWindowsExecutable } =
  require("../../shell/agent-process.mjs") as {
    resolveWindowsExecutable(
      command: string,
      options?: { env?: NodeJS.ProcessEnv; exists?: (path: string) => boolean },
    ): string;
    buildSpawnSpec(
      command: string,
      args?: string[],
      options?: {
        platform?: NodeJS.Platform;
        env?: NodeJS.ProcessEnv;
        exists?: (path: string) => boolean;
      },
    ): {
      command: string;
      args: string[];
      options: { windowsHide?: boolean; windowsVerbatimArguments?: boolean };
    };
    resolveAgentLaunch(options: {
      repoRoot: string;
      resourcesPath?: string | null;
      devUrl?: string | null;
      explicitBin?: string | null;
      platform?: NodeJS.Platform;
      env?: NodeJS.ProcessEnv;
      exists?: (path: string) => boolean;
    }): {
      executable: string;
      command: string;
      args: string[];
      options: { windowsHide?: boolean; windowsVerbatimArguments?: boolean };
    };
  };

describe("Windows sidecar process resolution", () => {
  test("resolves bun.cmd via PATH and wraps it through ComSpec with windowsHide", () => {
    const existing = new Set(["C:\\Users\\dev\\AppData\\Roaming\\npm\\bun.cmd"]);
    const launch = resolveAgentLaunch({
      repoRoot: "C:\\work\\flecten",
      resourcesPath: null,
      devUrl: "http://localhost:5173",
      platform: "win32",
      env: {
        Path: "C:\\Windows\\System32;C:\\Users\\dev\\AppData\\Roaming\\npm",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      exists: (path) => existing.has(path),
    });

    expect(launch.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(launch.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(launch.args[3]).toContain("C:\\Users\\dev\\AppData\\Roaming\\npm\\bun.cmd");
    expect(launch.args[3]).toContain("server.ts");
    expect(launch.options).toEqual({ windowsHide: true, windowsVerbatimArguments: true });
  });

  test("prefers bun.exe over bun.cmd and falls back to USERPROFILE\\.bun\\bin\\bun.exe", () => {
    const fromProfile = resolveWindowsExecutable("bun", {
      env: { Path: "C:\\Windows\\System32", USERPROFILE: "C:\\Users\\alex" },
      exists: (path) => path === "C:\\Users\\alex\\.bun\\bin\\bun.exe",
    });
    expect(fromProfile).toBe("C:\\Users\\alex\\.bun\\bin\\bun.exe");

    const launch = buildSpawnSpec("bun", ["run", "C:\\work\\src\\app\\server.ts"], {
      platform: "win32",
      env: { Path: "C:\\Windows\\System32", USERPROFILE: "C:\\Users\\alex" },
      exists: (path) => path === "C:\\Users\\alex\\.bun\\bin\\bun.exe",
    });
    expect(launch).toEqual({
      command: "C:\\Users\\alex\\.bun\\bin\\bun.exe",
      args: ["run", "C:\\work\\src\\app\\server.ts"],
      options: { windowsHide: true },
    });
  });

  test("launches packaged flecten-agent.exe directly with windowsHide", () => {
    const packaged = "C:\\Program Files\\Flecten\\resources\\flecten-agent.exe";
    const launch = resolveAgentLaunch({
      repoRoot: "C:\\Program Files\\Flecten\\resources\\app.asar",
      resourcesPath: "C:\\Program Files\\Flecten\\resources",
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      exists: (path) => path === packaged,
    });
    expect(launch.executable).toBe(packaged);
    expect(launch.command).toBe(packaged);
    expect(launch.args).toEqual([]);
    expect(launch.options).toEqual({ windowsHide: true });
  });

  test("rejects control line breaks in Windows batch arguments", () => {
    expect(() =>
      buildSpawnSpec("C:\\tools\\bun.cmd", ["ok\ncalc.exe"], {
        platform: "win32",
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        exists: () => true,
      }),
    ).toThrow("line breaks");
  });
});

describe("Windows environment, shell, shadow git and voice resolution", () => {
  test("keeps essential Windows system and user profile variables in terminal and shadow git env", () => {
    const allowlist = defaultTerminalEnvAllowlist("win32");
    for (const key of ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "SystemRoot", "TEMP", "TMP"]) {
      expect(allowlist).toContain(key);
    }

    const built = buildEnvironment(
      "C:\\work\\repo",
      "cmd.exe",
      { USERPROFILE: "C:\\Users\\alex" },
      ["USERPROFILE"],
      "win32",
    );
    expect(built.HOME).toBe("C:\\Users\\alex");

    const gitEnv = gitBaseEnvironment("win32", {
      Path: "C:\\Program Files\\Git\\cmd",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Users\\alex\\AppData\\Local\\Temp",
      USERPROFILE: "C:\\Users\\alex",
      APPDATA: "C:\\Users\\alex\\AppData\\Roaming",
    });
    expect(gitEnv.PATH).toBe("C:\\Program Files\\Git\\cmd");
    expect(gitEnv.SystemRoot).toBe("C:\\Windows");
    expect(gitEnv.TEMP).toBe("C:\\Users\\alex\\AppData\\Local\\Temp");
    expect(gitEnv.HOME).toBe("C:\\Users\\alex");
    expect(gitEnv.APPDATA).toBe("C:\\Users\\alex\\AppData\\Roaming");
  });

  test("resolves cmd.exe and powershell.exe via ComSpec/SystemRoot when PATH lookup misses", () => {
    expect(
      resolveShell(
        "cmd.exe",
        "win32",
        { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        (path) => path === "C:\\Windows\\System32\\cmd.exe",
        () => null,
      ),
    ).toBe("C:\\Windows\\System32\\cmd.exe");

    expect(
      resolveShell(
        "powershell.exe",
        "win32",
        { SystemRoot: "C:\\Windows" },
        (path) => path === "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        () => null,
      ),
    ).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });

  test("wraps .cmd auth helpers via ComSpec and sets Windows scratch TEMP/TMP", () => {
    const spec = spawnCommandSpec("gcloud", ["auth", "print-access-token"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      which: () => "C:\\Program Files\\Google\\gcloud.cmd",
    });
    expect(spec.windowsVerbatimArguments).toBe(true);
    expect(spec.cmd.slice(0, 3)).toEqual(["C:\\Windows\\System32\\cmd.exe", "/d", "/s"]);
    expect(spec.cmd[4]).toContain("gcloud.cmd");

    expect(scratchEnvironment("C:\\scratch\\s1", "win32")).toEqual({
      TMPDIR: "C:\\scratch\\s1",
      TEMP: "C:\\scratch\\s1",
      TMP: "C:\\scratch\\s1",
      FLECTEN_SCRATCH: "C:\\scratch\\s1",
    });
  });

  test("skips Windows Store python3 stub and falls back to python or py -3", () => {
    expect(
      resolvePythonCommand("python3", {
        platform: "win32",
        which: (name) =>
          name === "python3"
            ? "C:\\Users\\alex\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe"
            : name === "python"
              ? "C:\\Python312\\python.exe"
              : null,
      }),
    ).toEqual(["C:\\Python312\\python.exe"]);

    expect(
      resolvePythonCommand("python3", {
        platform: "win32",
        which: (name) => (name === "py" ? "C:\\Windows\\py.exe" : null),
      }),
    ).toEqual(["C:\\Windows\\py.exe", "-3"]);
  });

  test("normalizes Windows paths across project comparisons, permissions, shell paths and UI labels", () => {
    expect(sameProjectPath("C:\\Users\\Alex\\Repo\\", "c:/users/alex/repo", "win32")).toBe(true);
    expect(sameProjectPath("/work/Repo", "/work/repo", "linux")).toBe(false);
    expect(permissionPath("~\\.ssh\\id_ed25519", "/work")).toBe(
      permissionPath(resolve(homedir(), ".ssh\\id_ed25519"), "/work"),
    );
    expect(shellPaths('cat "~\\.ssh\\config" > NUL', "/work")).toContain(
      resolve(homedir(), ".ssh\\config"),
    );
    expect(shellPaths('cat "~\\.ssh\\config" > NUL', "/work")).not.toContain(
      resolve("/work", "NUL"),
    );
    expect(baseName("C:\\Users\\alex\\project\\src\\index.ts")).toBe("index.ts");
    expect(baseName("C:\\Users\\alex\\project\\")).toBe("project");
  });

  test("disables OS sandbox by default on Windows across access modes while keeping Linux/macOS isolated", () => {
    expect(defaultSandboxEnabled("win32")).toBe(false);
    expect(defaultSandboxEnabled("linux")).toBe(true);
    expect(defaultSandboxEnabled("darwin")).toBe(true);

    const winModes = accessModes("win32");
    expect(winModes.agent.sandbox.enabled).toBe(false);
    expect(winModes.confirm.sandbox.enabled).toBe(false);
    expect(winModes.full.sandbox.enabled).toBe(false);

    const config = {
      permissions: { ...winModes.agent.permissions },
      sandbox: { ...winModes.agent.sandbox },
    };
    expect(activeAccessMode(config, "win32")).toBe("agent");
    applyAccessMode(config, "confirm", "win32");
    expect(config.permissions.shell).toBe("ask");
    expect(config.sandbox.enabled).toBe(false);
    expect(activeAccessMode(config, "win32")).toBe("confirm");
  });

  test("rejects reserved Windows device names and trailing space/dot path segments", () => {
    for (const bad of [
      "CON",
      "nul",
      "src/PRN.txt",
      "a\\COM1.json",
      "lpt9",
      "dir/file ",
      "dir/a.",
    ]) {
      expect(windowsReservedPathError(bad, "win32")).toBeDefined();
    }
    for (const ok of ["C:\\work\\src\\index.ts", "src/console.ts", ".env", "docs/readme.md"]) {
      expect(windowsReservedPathError(ok, "win32")).toBeUndefined();
    }
    expect(windowsReservedPathError("NUL", "linux")).toBeUndefined();
  });

  test("matches ReadTracker paths case-insensitively on Windows and normalizes ConPTY CRLF + deep links", () => {
    const tracker = new ReadTracker("win32");
    tracker.record("C:\\Work\\src\\App.svelte", "hello");
    expect(tracker.verify("c:/work/src/app.svelte", "hello")).toBe("ok");
    expect(tracker.verify("C:\\Work\\SRC\\APP.SVELTE", "changed")).toBe("changed");
    expect(tracker.markSymbolShown("C:\\Work\\src\\App.svelte", 1, 5, "body")).toBe(false);
    expect(tracker.markSymbolShown("c:/work/src/app.svelte", 1, 5, "body")).toBe(true);

    const multi = commandWithCompletion("echo line1\necho line2", "cmd.exe", "__M__");
    expect(multi).toBe("echo line1\r\necho line2\r\necho __M__%errorlevel%:\r\n");

    const parsed = parseSessionLink("flecten://session/s_123/?project=%2Fwork%2Frepo");
    expect(parsed).toEqual({ id: "s_123", project: "/work/repo" });
  });
});
