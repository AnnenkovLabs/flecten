import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalPath } from "../util/canonical-path";
import { parseShell, programName } from "./shell-lexer";
import type { SandboxDecision, SandboxOptions } from "./types";

export const DEFAULT_PROTECTED_WRITE_PREFIXES = [
  ".git",
  ".agents",
  ".codex",
  ".mcp.json",
  ".liquid",
  "flecten.config.json",
  "liquid.config.json",
  "AGENTS.md",
  "secrets.json",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "~/.ssh",
  "~/.aws",
] as const;

export const DEFAULT_PROTECTED_READ_PREFIXES = [
  ".liquid/secrets.json",
  "secrets.json",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  "~/.ssh",
  "~/.aws",
] as const;

const NETWORK_COMMANDS = new Set([
  "curl",
  "ftp",
  "nc",
  "ncat",
  "netcat",
  "ping",
  "scp",
  "sftp",
  "ssh",
  "telnet",
  "wget",
]);

const PRIVILEGED_COMMANDS = new Set(["doas", "su", "sudo"]);
const SAFE_DEVICE_PATHS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/zero"]);

type CanonicalPath = {
  path: string;
  symlink: boolean;
};

type CanonicalFailure = {
  error: string;
};

export class SandboxPolicy {
  readonly workspaceRoot: string;
  readonly allowNetwork: boolean;
  readonly readDenyPrefixes: readonly string[];
  readonly writeDenyPrefixes: readonly string[];
  readonly envAllowlist: readonly string[];
  private readonly rootPath: string;
  private readonly customWriteDenyPrefixes: readonly string[];

  constructor(options: SandboxOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.rootPath = normalizePath(canonicalPath(this.workspaceRoot));
    this.allowNetwork = options.allowNetwork ?? false;
    this.readDenyPrefixes = [
      ...DEFAULT_PROTECTED_READ_PREFIXES,
      ...(options.readDenyPrefixes ?? []),
    ];
    this.customWriteDenyPrefixes = options.writeDenyPrefixes ?? [];
    this.writeDenyPrefixes = [
      ...DEFAULT_PROTECTED_WRITE_PREFIXES,
      ...(options.writeDenyPrefixes ?? []),
    ];
    this.envAllowlist = options.envAllowlist ?? [];
  }

  checkRead(path: string): Promise<SandboxDecision> {
    return this.check(path, "read");
  }

  checkWrite(path: string): Promise<SandboxDecision> {
    return this.check(path, "write");
  }

  /** A fixed native capability may persist its own metadata; raw file writes stay protected. */
  checkMemory(mode: "read" | "write"): Promise<SandboxDecision> {
    return this.check(
      join(this.workspaceRoot, ".liquid", "memory.json"),
      mode,
      mode === "write"
        ? [...DEFAULT_PROTECTED_READ_PREFIXES, ...this.customWriteDenyPrefixes]
        : this.readDenyPrefixes,
    );
  }

  // ponytail: shell paths are checked lexically; enforce subprocesses and relative escapes in the OS sandbox at spawn.
  checkShell(command: string): SandboxDecision {
    if (command.trim().length === 0) return deny("Shell: команда не указана.");
    for (const simple of parseShell(command).commands) {
      const name = programName(simple.argv[0]?.value ?? "");
      if (PRIVILEGED_COMMANDS.has(name)) {
        return deny(`Shell: команда "${name}" требует прав, которых нет у песочницы.`);
      }
      if (!this.allowNetwork && NETWORK_COMMANDS.has(name)) {
        return deny(`Shell: команда "${name}" использует сеть, а сеть запрещена.`);
      }
      const words = [
        ...simple.argv.map((word) => word.value),
        ...simple.assignments,
        ...simple.redirects.map((redirect) => redirect.target),
      ];
      for (const token of words) {
        const argument = absoluteArgument(token);
        if (argument === undefined || SAFE_DEVICE_PATHS.has(argument)) continue;
        if (
          !containsPath(normalizePath(this.workspaceRoot), normalizePath(argument)) &&
          !this.insideWorkspace(normalizePath(argument))
        ) {
          return deny(`Shell: путь "${argument}" вне рабочей папки "${this.workspaceRoot}".`);
        }
      }
    }
    return allow("Shell: команда не нарушает политику песочницы.");
  }

  checkNetwork(host: string): SandboxDecision {
    if (host.trim().length === 0) return deny("Сеть: адрес не указан.");
    if (!this.allowNetwork) return deny("Сеть запрещена политикой песочницы.");
    return allow(`Сеть разрешена для "${host}".`);
  }

  private async check(
    path: string,
    mode: "read" | "write",
    allowedPrefixes?: readonly string[],
  ): Promise<SandboxDecision> {
    const label = mode === "read" ? "Чтение" : "Запись";
    if (path.length === 0 || path.trim().length === 0) {
      return deny(`${label}: путь не указан.`);
    }
    if (path.includes("\0")) return deny(`${label}: путь содержит запрещённый символ.`);
    const canonical = await canonicalize(path, this.workspaceRoot);
    if ("error" in canonical) {
      return deny(`${label} "${path}" невозможно проверить: ${canonical.error}.`);
    }
    const prefixes =
      allowedPrefixes ?? (mode === "read" ? this.readDenyPrefixes : this.writeDenyPrefixes);
    let blocked: string | undefined;
    const lexical = normalizePath(resolve(this.workspaceRoot, expandHome(path)));
    for (const prefix of prefixes) {
      const full = this.prefixPath(prefix);
      const resolved = await canonicalize(full, this.workspaceRoot);
      if (
        containsPath(full, lexical) ||
        containsPath(full, canonical.path) ||
        (!("error" in resolved) && containsPath(resolved.path, canonical.path))
      ) {
        blocked = prefix;
        break;
      }
    }
    if (blocked !== undefined) {
      return deny(`${label} "${canonical.path}" запрещено: защищённый путь "${blocked}".`);
    }
    if (!this.insideWorkspace(canonical.path)) {
      return deny(
        canonical.symlink
          ? `${label} "${canonical.path}" запрещено: символическая ссылка ведёт за пределы рабочей папки.`
          : `${label} "${canonical.path}" запрещено: путь вне рабочей папки "${this.workspaceRoot}".`,
      );
    }
    return allow(`${label} "${canonical.path}" разрешено: путь внутри рабочей папки.`);
  }

  private insideWorkspace(path: string): boolean {
    return containsPath(this.rootPath, path);
  }

  private prefixPath(prefix: string): string {
    return normalizePath(resolve(this.workspaceRoot, expandHome(prefix)));
  }
}

async function canonicalize(
  input: string,
  root: string,
): Promise<CanonicalPath | CanonicalFailure> {
  let current = resolve(root, expandHome(input));
  const missing: string[] = [];
  while (true) {
    const stats = await lstat(current).catch(() => undefined);
    if (stats !== undefined) {
      let real: string;
      try {
        real = await realpath(current);
      } catch {
        return { error: "не удалось разрешить символическую ссылку" };
      }
      const path = missing.length === 0 ? real : join(real, ...missing.reverse());
      return { path: normalizePath(path), symlink: stats.isSymbolicLink() };
    }
    const parent = dirname(current);
    if (parent === current) return { path: normalizePath(current), symlink: false };
    missing.push(basename(current));
    current = parent;
  }
}

function absoluteArgument(value: string): string | undefined {
  const equals = value.indexOf("=");
  const candidate = equals >= 0 ? value.slice(equals + 1) : value;
  return isAbsolute(candidate) ? candidate : undefined;
}

function normalizePath(value: string): string {
  if (process.platform !== "win32") return value;
  return value.split("\\").join("/").toLowerCase();
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

function containsPath(prefix: string, path: string): boolean {
  if (path === prefix) return true;
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(base);
}

function allow(reason: string): SandboxDecision {
  return { allowed: true, reason };
}

function deny(reason: string): SandboxDecision {
  return { allowed: false, reason };
}
