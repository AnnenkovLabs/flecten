import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PermissionAction, PermissionRequest } from "../../security/types";
import { parseApplyPatch } from "../../tools/apply-patch/run";
import type { Tool, ToolContext } from "../../tools/types";
import { isInside } from "../../tools/util/paths";
import { isObject } from "../../util/json";
import type { ToolCall } from "../types";
import { shellRisks } from "./shell-risk";

const FILE_ACTIONS: Record<string, PermissionAction> = {
  read: "read",
  grep: "read",
  glob: "read",
  write: "write",
  edit: "write",
  apply_patch: "write",
  delete: "write",
  move: "write",
};
const INTERNAL = new Set(["ask", "done", "task"]);
const GIT_READ = new Set(["status", "log", "branch"]);
const TERMINAL_READ = new Set(["read", "list"]);
const JOBS_READ = new Set(["list", "output", "wait"]);

function actionFor(tool: Tool, args: Record<string, unknown>): PermissionAction | undefined {
  if (tool.source === "mcp") return "mcp";
  if (tool.source === "module") return args.operation === "activate" ? "skill" : undefined;
  if (tool.source === "skill") return "skill";
  if (INTERNAL.has(tool.name)) return undefined;
  if (tool.name === "context")
    return args.op === "begin" || args.op === "complete" || args.op === "block"
      ? undefined
      : "read";
  if (tool.name === "memory")
    return ["save", "forget", "reconcile"].includes(String(args.operation)) ? "write" : "read";
  if (tool.name === "worker") return args.operation === "status" ? "read" : "write";
  if (tool.name === "todo") return args.op === "list" ? "read" : "write";
  if (tool.name === "git")
    return GIT_READ.has(String(args.operation)) ||
      (["diff", "show"].includes(String(args.operation)) && typeof args.path === "string")
      ? "read"
      : "shell";
  if (tool.name === "terminal") return TERMINAL_READ.has(String(args.op)) ? "read" : "shell";
  if (tool.name === "jobs") return JOBS_READ.has(String(args.op)) ? "read" : "shell";
  if (tool.name === "bash" || tool.name === "lsp") return "shell";
  if (["web", "web_fetch", "web_search"].includes(tool.name)) return "network";
  return FILE_ACTIONS[tool.name] ?? (tool.mutating ? "write" : "read");
}

/** Resolve existing ancestors too, so a workspace symlink cannot hide a denied resource. */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(
      await canonical(parent),
      path.slice(parent.length + (parent.endsWith("/") ? 0 : 1)),
    );
  }
}

function pathsFor(name: string, args: Record<string, unknown>): string[] {
  if (name === "memory") return [".liquid/memory.json"];
  if (name === "move") return [String(args.from), String(args.to)];
  if (name === "apply_patch")
    return parseApplyPatch(String(args.patch)).flatMap((file) => [
      file.path,
      ...(file.moveTo ? [file.moveTo] : []),
    ]);
  if (typeof args.path === "string") return [args.path];
  if (name === "grep" || name === "glob") return ["."];
  return [];
}

export function shellText(request: PermissionRequest): string | undefined {
  const args = request.args ?? {};
  const field = request.tool === "terminal" && args.op === "write" ? "input" : "command";
  return typeof args[field] === "string" ? args[field] : undefined;
}

/** Only native, typed operations can declare a bounded effect. Names from MCP never do. */
export async function permissionRequest(
  call: ToolCall,
  tool: Tool,
  context: ToolContext,
): Promise<PermissionRequest | undefined> {
  const args = isObject(call.args) ? call.args : {};
  const action = actionFor(tool, args);
  if (!action) return undefined;
  const native = tool.source === undefined || tool.source === "builtin";
  const paths = native
    ? tool.name === "context"
      ? [resolve(context.logDir, "..", "pages")]
      : pathsFor(tool.name, args)
    : [];
  const resources = new Set<string>();
  for (const path of paths) {
    const absolute = resolve(context.cwd, path);
    resources.add(absolute);
    resources.add(await canonical(absolute));
  }
  const known =
    FILE_ACTIONS[tool.name] !== undefined ||
    ["memory", "todo", "git", "terminal", "jobs", "worker", "context"].includes(tool.name);
  const bounded =
    ((native && known && (action === "read" || action === "write")) || tool.source === "skill") &&
    [...resources].every((path) => isInside(context.cwd, path));
  const request: PermissionRequest = {
    action,
    tool: tool.name,
    cwd:
      native && action === "shell" && typeof args.cwd === "string"
        ? resolve(context.cwd, args.cwd)
        : context.cwd,
    sessionId: context.approvalSessionId ?? context.sessionId,
    ...(context.permissionActor ? { actor: context.permissionActor } : {}),
    args,
    safety: bounded ? "bounded" : "unbounded",
    ...(paths[0] ? { path: resolve(context.cwd, paths[0]) } : {}),
    ...(resources.size ? { paths: [...resources] } : {}),
    ...(typeof args.why === "string" && args.why ? { reason: args.why } : {}),
  };
  const command = shellText(request);
  const target = paths.length
    ? paths.join(" → ")
    : (command ?? args.url ?? args.query ?? args.name ?? args.id ?? args.operation ?? args.op);
  if (typeof target === "string") request.target = target;
  if (action === "shell" && command !== undefined && tool.name !== "lsp") {
    const risks = await shellRisks(
      command,
      typeof args.cwd === "string" ? args.cwd : undefined,
      context,
    );
    if (risks.length) request.risks = risks;
  }
  // Native module trust covers the exact manifest declaration. An MCP server's hints do not.
  // Explicit MCP denies/checkpoints remain authoritative, including parent policies.
  if (tool.source === "mcp" && tool.permissionSafety === "read-only") {
    const mcp = context.permissions?.check(request);
    if (mcp?.policy !== "deny" && !mcp?.humanOnly) {
      request.action = "read";
      request.safety = "bounded";
    }
  }
  return request;
}
