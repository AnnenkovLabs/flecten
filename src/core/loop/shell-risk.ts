import { resolve } from "node:path";
import {
  classifyTargets,
  type DestructiveMatch,
  findDestructive,
} from "../../security/destructive";
import type { PermissionRisk } from "../../security/types";
import type { ToolContext } from "../../tools/types";

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** Why a destructive match cannot be undone by a shell checkpoint, or undefined when it can. */
async function uncovered(
  match: DestructiveMatch,
  cwd: string,
  context: ToolContext,
  snapshots: string | undefined,
): Promise<string | undefined> {
  if (match.rule.reach === "outside") {
    return "affects state outside the workspace (remote, history, system, or external data); cannot be undone.";
  }
  if (snapshots !== undefined) return `cannot be undone: ${snapshots}.`;
  const inside: string[] = [];
  for (const verdict of classifyTargets(match, cwd, context.cwd)) {
    if (verdict.kind === "unknown") {
      return `target "${verdict.word}" is resolved at runtime; undo is not guaranteed.`;
    }
    if (verdict.kind === "outside")
      return `path "${verdict.path}" is outside the workspace; cannot be undone.`;
    if (verdict.kind === "git-dir") return "may delete .git, which is not covered by snapshots.";
    inside.push(verdict.path);
  }
  if (inside.length === 0 || !context.shellCheckpoints) return undefined;
  const ignored = await context.shellCheckpoints.ignored(inside);
  if (!ignored.over) return undefined;
  const limits = context.shellCheckpoints.limits;
  return `ignored files (${ignored.files}+ files, ${megabytes(ignored.bytes)}) exceed snapshot limits (${limits.maxFiles} files, ${megabytes(limits.maxBytes)}).`;
}

/**
 * Destructive operations of a shell command that the user must confirm: everything that reaches
 * outside the workspace, and workspace deletes a checkpoint cannot cover.
 */
export async function shellRisks(
  command: string,
  shellCwd: string | undefined,
  context: ToolContext,
): Promise<PermissionRisk[]> {
  const matches = findDestructive(command).filter((match) => match.rule.confirm !== "never");
  if (matches.length === 0) return [];
  const cwd = resolve(context.cwd, shellCwd ?? ".");
  const snapshots = context.shellCheckpoints
    ? await context.shellCheckpoints.status()
    : "shell snapshots disabled";
  const risks = new Map<string, PermissionRisk>();
  for (const match of matches) {
    if (risks.has(match.rule.id)) continue;
    const detail = await uncovered(match, cwd, context, snapshots);
    if (detail !== undefined) {
      risks.set(match.rule.id, { id: match.rule.id, label: match.rule.label, detail });
    }
  }
  return [...risks.values()];
}
