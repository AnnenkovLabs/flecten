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
      return ["/d", "/s", "/c", command];
    case "powershell":
    case "pwsh":
      return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command];
    default:
      return ["-lc", command];
  }
}

export function resolveShell(shell: string): string | null {
  if (shell.includes("/") || shell.includes("\\")) return existsSync(shell) ? shell : null;
  return Bun.which(shell);
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
  if (env.HOME === undefined) env.HOME = cwd;
  if (env.TERM === undefined) env.TERM = "xterm-256color";
  env.SHELL = shell;
  env.PWD = cwd;
  return env;
}
