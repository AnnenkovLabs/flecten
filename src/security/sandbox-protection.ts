import { existsSync, lstatSync, statSync } from "node:fs";
import { canonicalExistingPath } from "../util/canonical-path";
import { permissionPath } from "./permission-request-key";
import { DEFAULT_PROTECTED_READ_PREFIXES, DEFAULT_PROTECTED_WRITE_PREFIXES } from "./sandbox";

export interface SandboxProtection {
  workspaceRoot: string;
  writablePaths?: readonly string[];
  readOnlyPaths?: string[];
  readDeniedPaths?: string[];
}

function resources(paths: readonly string[], root: string): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    const full = permissionPath(path, root);
    result.add(full);
    if (existsSync(full)) result.add(canonicalExistingPath(full));
  }
  return [...result];
}

/** Resolve protected symlinks on each spawn, rather than trusting a startup snapshot. */
export function sandboxProtection(policy: SandboxProtection): {
  readOnly: string[];
  readDenied: string[];
} {
  const roots = [policy.workspaceRoot, ...(policy.writablePaths ?? [])];
  return {
    readOnly: [
      ...new Set([
        ...roots.flatMap((root) => resources(DEFAULT_PROTECTED_WRITE_PREFIXES, root)),
        ...resources(policy.readOnlyPaths ?? [], policy.workspaceRoot),
      ]),
    ],
    readDenied: [
      ...new Set([
        ...roots.flatMap((root) => resources(DEFAULT_PROTECTED_READ_PREFIXES, root)),
        ...resources(policy.readDeniedPaths ?? [], policy.workspaceRoot),
      ]),
    ],
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
