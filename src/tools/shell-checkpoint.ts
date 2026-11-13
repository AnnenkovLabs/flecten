import type { ToolResult } from "../core/types";
import { classifyTargets, findDestructive } from "../security/destructive";
import type { ShellCheckpointSummary } from "../store/checkpoints";
import { isObject } from "../util/json";
import type { ToolContext } from "./types";

const LABEL_CHARS = 80;

/** Workspace paths a command deletes by name; their ignored files join the "before" snapshot. */
export function deletedPaths(command: string, cwd: string, root: string): string[] {
  const paths = new Set<string>();
  for (const match of findDestructive(command)) {
    if (match.rule.reach !== "workspace" || match.rule.operands === "tree") continue;
    for (const verdict of classifyTargets(match, cwd, root)) {
      if (verdict.kind === "inside") paths.add(verdict.path);
    }
  }
  return [...paths];
}

function label(tool: string, command: string): string {
  const line = command.split("\n")[0] ?? command;
  const short = line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 3)}...` : line;
  return `${tool}: ${short}`;
}

export function withCheckpointData(
  result: ToolResult,
  checkpoint: ShellCheckpointSummary,
): ToolResult {
  const data = isObject(result.data) ? result.data : {};
  return { ...result, data: { ...data, checkpoint } };
}

/**
 * Runs a shell step between two workspace snapshots and saves what changed as a checkpoint,
 * so `/undo` also covers bash, terminal input and background jobs.
 */
export async function withShellCheckpoint(
  context: ToolContext,
  step: { tool: string; command: string; cwd: string },
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const shell = context.shellCheckpoints;
  if (!shell) return run();
  const include = deletedPaths(step.command, step.cwd, context.cwd);
  const handle = await shell.begin({
    tool: step.tool,
    label: label(step.tool, step.command),
    command: step.command,
    sessionId: context.sessionId,
    ...(include.length > 0 ? { include } : {}),
  });
  let result: ToolResult;
  try {
    result = await run();
  } catch (error) {
    await handle.finish();
    throw error;
  }
  return withCheckpointData(result, await handle.finish());
}
