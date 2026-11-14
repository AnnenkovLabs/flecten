import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { permissionPath } from "../../security/permission-request-key";
import type { PermissionRequest } from "../../security/types";
import type { ToolContext } from "../../tools/types";
import { isInside } from "../../tools/util/paths";
import { canonicalPath } from "../../util/canonical-path";

/** Select the existing containing directory, so a shell mount can enforce exactly the shown scope. */
async function directoryFor(path: string): Promise<string> {
  let current = path;
  while (true) {
    const info = await stat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
      throw error;
    });
    if (info?.isDirectory()) return canonicalPath(current);
    const parent = dirname(current);
    if (parent === current) return canonicalPath(current);
    current = parent;
  }
}

export async function externalDirectories(
  request: PermissionRequest,
  context: ToolContext,
): Promise<string[]> {
  const roots = new Set<string>();
  for (const path of request.paths ?? [])
    if (!isInside(context.cwd, path)) roots.add(await directoryFor(path));
  return [...roots].filter(
    (root, _index, all) => !all.some((parent) => parent !== root && isInside(parent, root)),
  );
}

export function externalRequest(request: PermissionRequest, path: string): PermissionRequest {
  return {
    action: "external_path",
    tool: request.tool,
    cwd: request.cwd,
    path,
    paths: [path, ...(request.paths ?? []).filter((resource) => isInside(path, resource))],
    target: path,
    safety: "bounded",
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.actor ? { actor: request.actor } : {}),
    ...(request.reason ? { reason: request.reason } : {}),
    args: { access: "read_write", operation: request.tool, requestedTarget: request.target ?? "" },
  };
}

/** Refresh leases after every approval and immediately before execution. Once stays on this call. */
export function withExternalAccess(context: ToolContext): ToolContext {
  const sessionId = context.approvalSessionId ?? context.sessionId;
  const paths = [
    ...new Set([
      ...(context.permissions?.externalRoots(sessionId, context.cwd) ?? []).map((path) =>
        permissionPath(path, context.cwd),
      ),
      ...(context.authorizedExternalPaths ?? []),
    ]),
  ].sort();
  const deniedRoots = context.permissions?.externalDeniedRoots(context.cwd) ?? [];
  return {
    ...context,
    authorizedExternalPaths: paths,
    ...(context.sandbox && paths.join("\0") !== context.sandbox.externalPaths.join("\0")
      ? { sandbox: context.sandbox.withExternalPaths(paths) }
      : {}),
    ...(context.osSandbox
      ? {
          osSandbox: {
            ...context.osSandbox,
            ...(deniedRoots.length
              ? {
                  readDeniedPaths: [
                    ...new Set([...(context.osSandbox.readDeniedPaths ?? []), ...deniedRoots]),
                  ].sort(),
                }
              : {}),
            ...(paths.length
              ? {
                  writablePaths: [
                    ...new Set([...(context.osSandbox.writablePaths ?? []), ...paths]),
                  ].sort(),
                }
              : {}),
          },
        }
      : {}),
  };
}

const directoryWaits = new WeakMap<
  NonNullable<ToolContext["permissions"]>,
  Map<string, Promise<unknown>>
>();

/** Concurrent tools share a folder decision. A once-only answer makes the next call ask separately. */
export async function serializeDirectoryAccess<T>(
  context: ToolContext,
  path: string,
  task: () => Promise<T>,
): Promise<T> {
  const engine = context.permissions;
  if (!engine) return task();
  const waits = directoryWaits.get(engine) ?? new Map<string, Promise<unknown>>();
  directoryWaits.set(engine, waits);
  const key = `${context.approvalSessionId ?? context.sessionId}\0${path}`;
  const previous = waits.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  waits.set(key, next);
  try {
    return await next;
  } finally {
    if (waits.get(key) === next) waits.delete(key);
  }
}
