import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { defaultTerminalEnvAllowlist } from "./settings";

export function shellName(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name;
}

export function shellArgs(shell: string): string[] {
  switch (shellName(shell).toLowerCase()) {
    case "cmd":
      return ["/d", "/q", "/k"];
    case "powershell":
    case "pwsh":
      return ["-NoLogo", "-NoProfile", "-NoExit"];
    case "bash":
      return ["-i", "+m"];
    default:
      return ["-i"];
  }
}

export function shellCommandArgs(shell: string, command: string): string[] {
  switch (shellName(shell).toLowerCase()) {
    case "cmd":
      return ["/d", "/s", "/c", `"${command}"`];
    case "powershell":
    case "pwsh":
      return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command];
    default:
      return ["-lc", command];
  }
}

/** CMD parses its command string itself; CRT escaping would turn quotes into literal bytes. */
export function shellCommand(
  shell: string,
  command: string,
): { cmd: string[]; windowsVerbatimArguments: boolean } {
  return {
    cmd: [shell, ...shellCommandArgs(shell, command)],
    windowsVerbatimArguments: shellName(shell).toLowerCase() === "cmd",
  };
}

const CMD_META = new Set('()[]%!^"`<>&|;, *?');
const WINDOWS_SHIM_EXTENSIONS = new Set([".cmd", ".bat"]);

function envLookup(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((entry) => entry.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

function escapeCmdMeta(value: string): string {
  let out = "";
  for (const char of value) out += CMD_META.has(char) ? `^${char}` : char;
  return out;
}

function escapeCmdArgument(value: string, doubleEscape: boolean): string {
  let body = "";
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    if (char === '"') {
      body += `${"\\".repeat(slashes * 2 + 1)}"`;
      slashes = 0;
      continue;
    }
    if (slashes > 0) {
      body += "\\".repeat(slashes);
      slashes = 0;
    }
    body += char;
  }
  if (slashes > 0) body += "\\".repeat(slashes * 2);
  const once = escapeCmdMeta(`"${body}"`);
  return doubleEscape ? escapeCmdMeta(once) : once;
}

function isNodeModulesCmdShim(path: string): boolean {
  const normalized = path.replaceAll("/", "\\").toLowerCase();
  return normalized.includes("\\node_modules\\.bin\\") && normalized.endsWith(".cmd");
}

/** Resolves a direct executable or wraps Windows .cmd/.bat shims via ComSpec without shell interpolation. */
export function spawnCommandSpec(
  command: string,
  args: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    which?: (name: string) => string | null;
  } = {},
): { cmd: string[]; windowsVerbatimArguments: boolean } {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { cmd: [command, ...args], windowsVerbatimArguments: false };
  const env = options.env ?? process.env;
  const which = options.which ?? ((name: string) => Bun.which(name));
  const resolved =
    command.includes("/") || command.includes("\\") ? command : (which(command) ?? command);
  const dot = resolved.lastIndexOf(".");
  const slash = Math.max(resolved.lastIndexOf("/"), resolved.lastIndexOf("\\"));
  const ext = dot > slash ? resolved.slice(dot).toLowerCase() : "";
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return { cmd: [resolved, ...args], windowsVerbatimArguments: false };
  }
  const normalized = win32.normalize(resolved);
  for (const part of [normalized, ...args]) {
    if (part.includes("\0") || part.includes("\r") || part.includes("\n")) {
      throw new Error("Windows batch command arguments cannot contain control line breaks");
    }
  }
  const comspec =
    envLookup(env, "ComSpec")?.trim() ||
    (() => {
      const root = envLookup(env, "SystemRoot")?.trim() || envLookup(env, "WINDIR")?.trim();
      return root ? win32.join(root, "System32", "cmd.exe") : "cmd.exe";
    })();
  const doubleEscape = isNodeModulesCmdShim(normalized);
  const line = [
    escapeCmdMeta(normalized),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscape)),
  ].join(" ");
  return { cmd: [comspec, "/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

export function resolveShell(
  shell: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = (name) => Bun.which(name),
): string | null {
  if (shell.includes("/") || shell.includes("\\")) return exists(shell) ? shell : null;
  const found = which(shell);
  if (found !== null) return found;
  if (platform === "win32") {
    const lower = shellName(shell).toLowerCase();
    const root = envLookup(env, "SystemRoot")?.trim() || envLookup(env, "WINDIR")?.trim();
    if (lower === "cmd") {
      const candidates = [
        envLookup(env, "ComSpec")?.trim(),
        root ? win32.join(root, "System32", "cmd.exe") : undefined,
      ];
      for (const candidate of candidates) {
        if (candidate && exists(candidate)) return candidate;
      }
    }
    if (lower === "powershell" && root) {
      const candidate = win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function buildEnvironment(
  cwd: string,
  shell: string,
  explicit: Record<string, string> | undefined,
  allowlist: readonly string[] | undefined = undefined,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = new Map(
    [...(allowlist ?? []), ...defaultTerminalEnvAllowlist(platform)].map((key) => [
      key.toUpperCase(),
      key,
    ]),
  );
  const canonicalKey = (key: string): string =>
    platform === "win32" ? (keys.get(key.toUpperCase()) ?? key) : key;
  for (const configured of allowlist ?? defaultTerminalEnvAllowlist(platform)) {
    const key = canonicalKey(configured);
    const inherited =
      platform === "win32"
        ? Object.keys(process.env).find((name) => name.toUpperCase() === key.toUpperCase())
        : key;
    const value = key === "PWD" ? cwd : key === "SHELL" ? shell : process.env[inherited ?? key];
    if (value !== undefined && value.length > 0) env[key] = value;
  }
  for (const [name, value] of Object.entries(explicit ?? {})) {
    const key = canonicalKey(name);
    if (key === "PWD" || key === "SHELL") continue;
    env[key] = value;
  }
  if (env.PATH === undefined) {
    const root =
      env.SystemRoot ?? env.WINDIR ?? process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
    env.PATH =
      platform === "win32"
        ? [
            win32.join(root, "System32"),
            root,
            win32.join(root, "System32", "WindowsPowerShell", "v1.0"),
          ].join(";")
        : "/usr/local/bin:/usr/bin:/bin";
  }
  if (env.HOME === undefined) {
    env.HOME =
      platform === "win32"
        ? (env.USERPROFILE ?? envLookup(process.env, "USERPROFILE") ?? cwd)
        : cwd;
  }
  if (env.TERM === undefined) env.TERM = "xterm-256color";
  env.SHELL = shell;
  env.PWD = cwd;
  return env;
}
