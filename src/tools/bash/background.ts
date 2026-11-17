import type { ToolResult } from "../../core/types";
import { jobView } from "../jobs/view";
import { deletedPaths } from "../shell-checkpoint";
import type { ToolContext } from "../types";
import { prepareScratch, scratchEnvironment } from "../util/scratch";
import type { BashArgs } from "./schema";

/**
 * Starts `bash` as a background job: the call returns at once with the job id. The checkpoint
 * spans the job's lifetime and is saved when it exits; the session then notifies the model.
 */
export async function startBackgroundBash(
  args: BashArgs,
  context: ToolContext,
  cwd: string,
): Promise<ToolResult> {
  const manager = context.terminals;
  if (!manager) return { ok: false, output: "", error: "Background jobs are not available" };
  const protection = context.providerProtection;
  await prepareScratch(context.scratchDir);
  const include = deletedPaths(args.command, cwd, context.cwd);
  const command = protection ? protection.vault.protect(args.command) : args.command;
  const handle = await context.shellCheckpoints?.begin({
    tool: "job",
    label: `job: ${command.split("\n")[0] ?? command}`.slice(0, 80),
    command,
    sessionId: context.sessionId,
    ...(include.length > 0 ? { include } : {}),
  });
  const job = manager.startJob(
    args.command,
    {
      cwd,
      env: { ...context.env, ...scratchEnvironment(context.scratchDir) },
      ...(protection ? { protectOutput: (text: string) => protection.vault.protect(text) } : {}),
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      ...(context.osSandbox
        ? {
            sandbox: {
              ...context.osSandbox,
              ...(context.scratchDir ? { temporaryDirectory: context.scratchDir } : {}),
            },
          }
        : {}),
    },
    async () => {
      const checkpoint = await handle?.finish();
      return checkpoint ? { checkpoint } : undefined;
    },
  );
  const view = jobView(job.snapshot());
  if (view.status === "failed") {
    await manager.settledJob(job.id);
    return {
      ok: false,
      output: "",
      error: view.error ?? "Job failed to start",
      data: { kind: "job", job: view },
    };
  }
  return {
    ok: true,
    output: `Started background job ${view.id} (pid ${view.pid ?? "?"}).\nYou will be notified when it exits. Use the jobs tool to read output, wait or stop it; do not poll with sleep.`,
    data: { kind: "job", job: view },
  };
}
