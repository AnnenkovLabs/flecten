import { readdir } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { ToolResult } from "../../core/types";
import { atomicWrite } from "../../util/atomic";
import { runBashTool } from "../bash/run";
import { bashSpec } from "../bash/schema";
import { defineTool, type ToolContext } from "../types";
import remoteRunner from "./remote-runner.py" with { type: "text" };
import { type RemoteJob, RemoteJobSchema, RemoteSnapshotSchema } from "./remote-schema";
import type { JobsArgs } from "./schema";
import { prepareSshCapability } from "./ssh-capability";

const bash = defineTool({ ...bashSpec, mutating: true, execute: runBashTool });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const records = (context: ToolContext) => join(dirname(context.logDir), "remote-jobs");
const recordPath = (context: ToolContext, id: string) => join(records(context), `${id}.json`);

export async function savedRemoteJobs(context: ToolContext): Promise<RemoteJob[]> {
  const entries = await readdir(records(context)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const jobs: RemoteJob[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const parsed = RemoteJobSchema.safeParse(await Bun.file(join(records(context), entry)).json());
    if (parsed.success) jobs.push(parsed.data);
  }
  return jobs;
}

/** Every remote request passes through the ordinary guarded bash capability. */
export async function runRemoteJob(
  args: JobsArgs,
  context: ToolContext,
  prepareSsh: typeof prepareSshCapability = prepareSshCapability,
): Promise<ToolResult | undefined> {
  if (!args.remote && !args.id?.startsWith("remote-")) return undefined;
  if (!context.invokeTool)
    return { ok: false, output: "", error: "Guarded execution is unavailable" };
  let job: RemoteJob;
  if (args.op === "submit") {
    if (!args.remote || !args.argv)
      return { ok: false, output: "", error: "Remote submit requires remote and argv" };
    const id = args.id ?? `remote-${crypto.randomUUID()}`;
    job = RemoteJobSchema.parse({
      id,
      target: args.remote,
      argv: args.argv,
      directory: posix.join(
        args.remote.cwd,
        ".flecten-jobs",
        context.approvalSessionId ?? context.sessionId,
        id,
      ),
    });
    // Persist before submitting. A broken SSH response leaves a reconcilable handle.
    const saved = await Bun.file(recordPath(context, id)).exists();
    if (saved) {
      const previous = RemoteJobSchema.parse(await Bun.file(recordPath(context, id)).json());
      if (
        JSON.stringify(previous.target) !== JSON.stringify(job.target) ||
        JSON.stringify(previous.argv) !== JSON.stringify(job.argv)
      )
        return { ok: false, output: "", error: "Job id already belongs to another operation" };
      job = previous;
    } else await atomicWrite(recordPath(context, id), JSON.stringify(job), 0o600, context.signal);
  } else {
    if (!args.id || !RemoteJobSchema.shape.id.safeParse(args.id).success)
      return { ok: false, output: "", error: "Invalid remote job id" };
    const saved = await Bun.file(recordPath(context, args.id)).exists();
    if (!saved) return { ok: false, output: "", error: "Remote job not found in this session" };
    job = RemoteJobSchema.parse(await Bun.file(recordPath(context, args.id)).json());
  }
  const capability = await prepareSsh(job.target, context);
  if (!capability.ok) return capability;
  const deadline = Date.now() + Math.min(args.timeoutMs ?? 30_000, 60_000);
  for (;;) {
    const request = Buffer.from(
      JSON.stringify({
        op: args.op === "wait" ? "status" : args.op,
        id: job.id,
        directory: job.directory,
        cwd: job.target.cwd,
        ...(args.op === "submit" ? { argv: job.argv, runner: remoteRunner } : {}),
      }),
    ).toString("base64url");
    // The remote command is opaque to local path analysis and is quoted at both shell boundaries.
    const remoteCommand = [job.target.python, "-c", remoteRunner, request].map(quote).join(" ");
    const destination = `${job.target.user ? `${job.target.user}@` : ""}${job.target.host}`;
    const command = [
      "ssh",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "-p",
      String(job.target.port),
      ...capability.arguments,
      "--",
      destination,
      remoteCommand,
    ]
      .map(quote)
      .join(" ");
    const result = await context.invokeTool(
      bash,
      {
        command,
        timeoutMs: Math.min(15_000, Math.max(1, deadline - Date.now())),
      },
      capability.context,
    );
    if (!result.ok)
      return {
        ok: false,
        output: `Remote operation is unconfirmed. Reconcile ${job.id} with jobs status; do not repeat the workload.\n${result.output}`,
        error: result.error ?? "SSH transport failed",
        data: { kind: "remote_job", id: job.id, state: "uncertain", remote: job.target },
      };
    let raw: unknown;
    try {
      raw = JSON.parse(result.output);
    } catch {
      raw = undefined;
    }
    const state = RemoteSnapshotSchema.safeParse(raw);
    if (!state.success || state.data.id !== job.id)
      return {
        ok: false,
        output: "",
        error: "Remote response failed its job schema; the operation remains unconfirmed",
        data: { kind: "remote_job", id: job.id, state: "uncertain" },
      };
    job = { ...job, state: state.data };
    await atomicWrite(recordPath(context, job.id), JSON.stringify(job), 0o600, context.signal);
    if (
      args.op !== "wait" ||
      !["starting", "running"].includes(state.data.status) ||
      Date.now() >= deadline
    ) {
      const output = state.data.output
        ? `\n\nstdout:\n${state.data.output.stdout}\n\nstderr:\n${state.data.output.stderr}`
        : "";
      return {
        ok: !["failed", "uncertain"].includes(state.data.status),
        output: `${job.id} ${state.data.status}${state.data.exitCode === undefined ? "" : `, exit ${state.data.exitCode}`}${output}`,
        ...(state.data.error ? { error: state.data.error } : {}),
        data: { kind: "remote_job", job },
      };
    }
    await Bun.sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    context.signal.throwIfAborted();
  }
}
