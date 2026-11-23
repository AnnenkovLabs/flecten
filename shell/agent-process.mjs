import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix, win32 } from "node:path";

const CMD_META = new Set('()[]%!^"`<>&|;, *?');
const WINDOWS_SHIM_EXTENSIONS = new Set([".cmd", ".bat"]);
const WINDOWS_EXE_EXTENSIONS = [".exe", ".com", ".cmd", ".bat"];

function envValue(env, target) {
  const upper = target.toUpperCase();
  const key = Object.keys(env).find((name) => name.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

function hasPathSeparator(value) {
  return value.includes("/") || value.includes("\\");
}

function lowerExtension(value) {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const dot = value.lastIndexOf(".");
  return dot > slash ? value.slice(dot).toLowerCase() : "";
}

function windowsExtensions(env) {
  const raw = envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const configured = raw
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.startsWith("."));
  const ordered = [];
  for (const preferred of WINDOWS_EXE_EXTENSIONS) {
    if (configured.includes(preferred) || preferred === ".exe" || preferred === ".cmd") {
      ordered.push(preferred);
    }
  }
  for (const entry of configured) {
    if (!ordered.includes(entry)) ordered.push(entry);
  }
  return ordered;
}

function candidateBunLocations(env) {
  const locations = [];
  const bunInstall = envValue(env, "BUN_INSTALL")?.trim();
  const userProfile = envValue(env, "USERPROFILE")?.trim();
  const localAppData = envValue(env, "LOCALAPPDATA")?.trim();
  if (bunInstall) locations.push(win32.join(bunInstall, "bin", "bun.exe"));
  if (userProfile) locations.push(win32.join(userProfile, ".bun", "bin", "bun.exe"));
  if (localAppData) locations.push(win32.join(localAppData, "bun", "bin", "bun.exe"));
  return locations;
}

/** Resolves a Windows command across PATH, PATHEXT and standard Bun install directories. */
export function resolveWindowsExecutable(
  command,
  { env = process.env, exists = existsSync } = {},
) {
  const ext = lowerExtension(command);
  const extensions = ext ? [""] : windowsExtensions(env);
  if (hasPathSeparator(command)) {
    for (const suffix of extensions) {
      const candidate = `${command}${suffix}`;
      if (exists(candidate)) return candidate;
    }
    return command;
  }

  const rawPath = envValue(env, "PATH") ?? "";
  const directories = rawPath
    .split(";")
    .map((entry) => entry.trim().replaceAll('"', ""))
    .filter((entry) => entry.length > 0);
  for (const directory of directories) {
    for (const suffix of extensions) {
      const candidate = win32.join(directory, `${command}${suffix}`);
      if (exists(candidate)) return candidate;
    }
  }

  if (command.toLowerCase() === "bun" || command.toLowerCase() === "bun.exe") {
    for (const candidate of candidateBunLocations(env)) {
      if (exists(candidate)) return candidate;
    }
  }
  return command;
}

function escapeCmdMeta(value) {
  let out = "";
  for (const char of value) {
    out += CMD_META.has(char) ? `^${char}` : char;
  }
  return out;
}

function escapeCmdArgument(raw, doubleEscape) {
  const value = String(raw);
  let body = "";
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") {
      slashes += 1;
      continue;
    }
    if (char === '"') {
      body += "\\".repeat(slashes * 2 + 1) + '"';
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

function isNodeModulesCmdShim(path) {
  const normalized = path.replaceAll("/", "\\").toLowerCase();
  return normalized.includes("\\node_modules\\.bin\\") && normalized.endsWith(".cmd");
}

function windowsComSpec(env) {
  const comspec = envValue(env, "ComSpec")?.trim();
  if (comspec) return comspec;
  const root = envValue(env, "SystemRoot")?.trim() || envValue(env, "WINDIR")?.trim();
  return root ? win32.join(root, "System32", "cmd.exe") : "cmd.exe";
}

/**
 * Prepares a safe child_process.spawn specification across platforms.
 * On Windows, .exe binaries run directly with windowsHide, while .cmd/.bat shims
 * run through ComSpec with explicit verbatim quoting instead of shell: true.
 */
export function buildSpawnSpec(
  command,
  args = [],
  { platform = process.platform, env = process.env, exists = existsSync } = {},
) {
  if (platform !== "win32") {
    return { command, args: [...args], options: {} };
  }
  const resolved = resolveWindowsExecutable(command, { env, exists });
  const ext = lowerExtension(resolved);
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return { command: resolved, args: [...args], options: { windowsHide: true } };
  }
  const normalized = win32.normalize(resolved);
  for (const part of [normalized, ...args]) {
    const text = String(part);
    if (text.includes("\0") || text.includes("\r") || text.includes("\n")) {
      throw new Error("Windows batch command arguments cannot contain control line breaks");
    }
  }
  const doubleEscape = isNodeModulesCmdShim(normalized);
  const commandLine = [
    escapeCmdMeta(normalized),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscape)),
  ].join(" ");
  return {
    command: windowsComSpec(env),
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    options: { windowsHide: true, windowsVerbatimArguments: true },
  };
}

/** Resolves the bundled agent executable first, falling back to `bun run src/app/server.ts`. */
export function resolveAgentLaunch({
  repoRoot,
  resourcesPath = process.resourcesPath,
  devUrl = null,
  explicitBin = null,
  platform = process.platform,
  env = process.env,
  exists = existsSync,
}) {
  const pathApi = platform === "win32" ? win32 : posix;
  const joinPath = platform === process.platform ? join : pathApi.join;
  const script = joinPath(repoRoot, "src", "app", "server.ts");
  if (devUrl) {
    return {
      executable: "bun",
      ...buildSpawnSpec("bun", ["run", script], { platform, env, exists }),
    };
  }
  if (explicitBin && exists(explicitBin)) {
    return {
      executable: explicitBin,
      ...buildSpawnSpec(explicitBin, [], { platform, env, exists }),
    };
  }
  const names = platform === "win32" ? ["flecten-agent.exe", "flecten-agent"] : ["flecten-agent"];
  for (const name of names) {
    const packaged = resourcesPath ? joinPath(resourcesPath, name) : null;
    if (packaged && exists(packaged)) {
      return {
        executable: packaged,
        ...buildSpawnSpec(packaged, [], { platform, env, exists }),
      };
    }
    const built = joinPath(repoRoot, "dist", name);
    if (exists(built)) {
      return {
        executable: built,
        ...buildSpawnSpec(built, [], { platform, env, exists }),
      };
    }
  }
  return {
    executable: "bun",
    ...buildSpawnSpec("bun", ["run", script], { platform, env, exists }),
  };
}

/** Stops the sidecar cleanly; on Windows reaps the process tree so .cmd shims leave no orphan locks. */
export function terminateChildProcess(child, { platform = process.platform, env = process.env } = {}) {
  if (!child) return;
  try {
    child.stdin?.end();
  } catch {}
  if (platform === "win32" && typeof child.pid === "number" && child.pid > 0) {
    const root = envValue(env, "SystemRoot")?.trim() || envValue(env, "WINDIR")?.trim();
    const taskkill = root ? win32.join(root, "System32", "taskkill.exe") : "taskkill.exe";
    try {
      spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 2000,
        windowsHide: true,
      });
      return;
    } catch {}
  }
  try {
    child.kill("SIGTERM");
  } catch {}
}
