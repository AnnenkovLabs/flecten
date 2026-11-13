import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { permissionPath } from "./permission-request-key";
import { DEFAULT_PROTECTED_READ_PREFIXES, DEFAULT_PROTECTED_WRITE_PREFIXES } from "./sandbox";

export interface SandboxProtection {
  workspaceRoot: string;
  readOnlyPaths?: string[];
  readDeniedPaths?: string[];
}

function resources(paths: readonly string[], root: string): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    const full = permissionPath(path, root);
    result.add(full);
    if (existsSync(full)) result.add(realpathSync(full));
  }
  return [...result];
}

/** Resolve protected symlinks on each spawn, rather than trusting a startup snapshot. */
export function sandboxProtection(policy: SandboxProtection): {
  readOnly: string[];
  readDenied: string[];
} {
  return {
    readOnly: resources(
      [...DEFAULT_PROTECTED_WRITE_PREFIXES, ...(policy.readOnlyPaths ?? [])],
      policy.workspaceRoot,
    ),
    readDenied: resources(
      [...DEFAULT_PROTECTED_READ_PREFIXES, ...(policy.readDeniedPaths ?? [])],
      policy.workspaceRoot,
    ),
  };
}

export function bubblewrapProtectionArgs(policy: SandboxProtection): string[] {
  const protection = sandboxProtection(policy);
  const args: string[] = [];
  for (const path of protection.readOnly)
    if (existsSync(path) && !lstatSync(path).isSymbolicLink()) args.push("--ro-bind", path, path);
  for (const path of protection.readDenied) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue;
    if (statSync(path).isDirectory()) args.push("--tmpfs", path, "--remount-ro", path);
    else args.push("--ro-bind", "/dev/null", path);
  }
  return args;
}
