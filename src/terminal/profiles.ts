import { existsSync, realpathSync } from "node:fs";
import { win32 } from "node:path";
import type { TerminalProfile } from "../../shared/terminal";
import { resolveShell, shellName } from "./shell";

const STRIP_ENV_PREFIXES = ["FLECTEN_", "LIQUID_", "ELECTRON_", "NODE_CHANNEL_"];
const STRIP_ENV_EXACT = new Set([
  "CHROME_DESKTOP",
  "GDK_BACKEND",
  "ORIGINAL_XDG_CURRENT_DESKTOP",
  "NO_COLOR",
]);

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function profileLabel(shell: string): string {
  const lower = shellName(shell).toLowerCase();
  switch (lower) {
    case "zsh":
      return "zsh";
    case "bash":
      return "bash";
    case "fish":
      return "fish";
    case "nu":
      return "nushell";
    case "sh":
      return "sh";
    case "pwsh":
      return "PowerShell";
    case "powershell":
      return "Windows PowerShell";
    case "cmd":
      return "Command Prompt";
    case "wsl":
      return "WSL";
    default:
      return shellName(shell) || shell;
  }
}

/** Resolves the user's real default interactive shell for native terminals. */
export function detectDefaultUserShell(
  configured?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = (name) => Bun.which(name),
): string {
  const candidates: string[] = [];
  if (configured?.trim()) candidates.push(configured.trim());
  if (platform === "win32") {
    candidates.push("pwsh", "powershell", "cmd.exe");
  } else {
    const userShell = env.SHELL?.trim();
    if (userShell) candidates.push(userShell);
    candidates.push("zsh", "bash", "/bin/bash", "/bin/sh");
  }
  for (const candidate of candidates) {
    const resolved = resolveShell(candidate, platform, env, exists, which);
    if (resolved) return resolved;
  }
  return platform === "win32" ? "cmd.exe" : "/bin/sh";
}

/** Discovers available native shell profiles on the host, starting with the default shell. */
export function listShellProfiles(
  configured?: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = (name) => Bun.which(name),
): TerminalProfile[] {
  const defaultShell = detectDefaultUserShell(configured, platform, env, exists, which);
  const candidates: string[] = [defaultShell];
  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    candidates.push(
      "pwsh",
      "powershell",
      "cmd.exe",
      win32.join(programFiles, "Git", "bin", "bash.exe"),
      "wsl.exe",
    );
  } else {
    if (env.SHELL?.trim()) candidates.push(env.SHELL.trim());
    candidates.push("zsh", "bash", "fish", "nu", "sh");
  }

  const seen = new Set<string>();
  const profiles: TerminalProfile[] = [];
  const defaultCanonical = canonicalPath(defaultShell);

  for (const candidate of candidates) {
    const resolved = resolveShell(candidate, platform, env, exists, which);
    if (!resolved) continue;
    const key = platform === "win32" ? resolved.toLowerCase() : canonicalPath(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    const name = shellName(resolved).toLowerCase() || "shell";
    const id = profiles.some((entry) => entry.id === name) ? `${name}-${profiles.length}` : name;
    profiles.push({
      id,
      label: profileLabel(resolved),
      shell: resolved,
      isDefault:
        platform === "win32"
          ? resolved.toLowerCase() === defaultShell.toLowerCase()
          : key === defaultCanonical,
    });
  }
  return profiles;
}

/** Native interactive shell arguments with full job control (no +m suppression). */
export function interactiveShellArgs(
  shell: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const lower = shellName(shell).toLowerCase();
  switch (lower) {
    case "cmd":
      return ["/k"];
    case "powershell":
    case "pwsh":
      return ["-NoLogo"];
    case "bash":
      return platform === "darwin" ? ["-l", "-i"] : ["-i"];
    case "zsh":
      return platform === "darwin" ? ["-l", "-i"] : ["-i"];
    case "fish":
      return platform === "darwin" ? ["-l", "-i"] : ["-i"];
    case "nu":
      return platform === "darwin" ? ["-l"] : [];
    default:
      return ["-i"];
  }
}

/** Builds a clean native user environment for interactive terminals. */
export function buildInteractiveEnvironment(
  cwd: string,
  shell: string,
  explicit: Record<string, string> | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (STRIP_ENV_EXACT.has(key)) continue;
    if (STRIP_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(explicit ?? {})) {
    env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "Flecten";
  env.SHELL = shell;
  env.PWD = cwd;
  if (platform !== "win32" && !env.LANG && !env.LC_ALL) {
    env.LANG = "en_US.UTF-8";
  }
  return env;
}
