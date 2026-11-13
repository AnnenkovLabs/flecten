import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { PermissionRequest, PermissionRule } from "./types";

export function permissionPath(path: string, cwd: string): string {
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  const absolute = resolve(cwd, expanded);
  return process.platform === "win32" ? absolute.split("\\").join("/").toLowerCase() : absolute;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Bind grants to the entire prepared operation, including content, cwd and every resource. */
export function permissionRequestKey(request: PermissionRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          action: request.action,
          tool: request.tool,
          actor: request.actor ?? "",
          cwd: permissionPath(request.cwd, request.cwd),
          paths: [
            ...new Set(
              [...(request.paths ?? []), ...(request.path ? [request.path] : [])].map((path) =>
                permissionPath(path, request.cwd),
              ),
            ),
          ].sort(),
          target: request.target ?? "",
          arguments: request.args ?? {},
          risks: (request.risks ?? []).map((risk) => risk.id).sort(),
        }),
      ),
    )
    .digest("hex");
}

export function matchesPermissionRule(
  rule: PermissionRule,
  request: PermissionRequest,
  path?: string,
): boolean {
  if (rule.action !== request.action || (rule.tool !== undefined && rule.tool !== request.tool))
    return false;
  if (rule.requestKey !== undefined && rule.requestKey !== permissionRequestKey(request))
    return false;
  if (
    rule.cwd !== undefined &&
    permissionPath(rule.cwd, request.cwd) !== permissionPath(request.cwd, request.cwd)
  )
    return false;
  if (rule.pathPrefix === undefined) return true;
  if (path === undefined) return false;
  const prefix = permissionPath(rule.pathPrefix, request.cwd);
  const actual = permissionPath(path, request.cwd);
  return actual === prefix || actual.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

export function grantLabel(request: PermissionRequest): string {
  return `${request.tool}: ${request.target ?? request.path ?? request.action}\n${request.cwd}`;
}
