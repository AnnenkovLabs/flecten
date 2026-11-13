import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";
import type { JobsArgs } from "./schema";
import { jobLine, jobView, tail } from "./view";

const DEFAULT_LINES = 80;
const MAX_OUTPUT_CHARS = 50_000;

function failure(error: string): ToolResult {
  return { ok: false, output: "", error };
}

export async function runJobs(args: JobsArgs, context: ToolContext): Promise<ToolResult> {
  const manager = context.terminals;
  if (!manager) return failure("Background jobs are not available in this session");

  if (args.op === "list") {
    const jobs = manager.listJobs().map((job) => jobView(job.snapshot()));
    return {
      ok: true,
      output: jobs.length === 0 ? "No background jobs." : jobs.map(jobLine).join("\n"),
      data: { kind: "jobs", jobs },
    };
  }

  if (args.id === undefined) return failure(`${args.op} needs id`);
  const job = manager.getJob(args.id);
  if (!job) return failure(`Job ${args.id} not found. Use op=list to see job ids.`);
  const lines = args.lines ?? DEFAULT_LINES;

  if (args.op === "output") {
    const snapshot = job.snapshot();
    const view = jobView(snapshot);
    const text =
      args.offset === undefined
        ? tail(snapshot.log, lines)
        : snapshot.log.slice(args.offset, args.offset + MAX_OUTPUT_CHARS);
    const next = args.offset === undefined ? snapshot.log.length : args.offset + text.length;
    return {
      ok: true,
      output: `${jobLine(view)}\nnext offset: ${next}\n\n${text}`,
      data: { kind: "jobs", job: view, nextOffset: next },
    };
  }

  if (args.op === "stop") {
    const snapshot = await manager.stopJob(args.id);
    if (snapshot === null) return failure(`Job ${args.id} not found`);
    await manager.settledJob(args.id);
    const view = jobView(snapshot);
    return {
      ok: true,
      output: `${jobLine(view)}\n\n${tail(snapshot.log, lines)}`,
      data: { kind: "jobs", job: view },
    };
  }

  const waited = await waitAbortable(job.wait(args.timeoutMs), context.signal);
  if (waited === "aborted") return failure("Wait aborted; the job keeps running");
  const view = jobView(waited.job);
  const state = waited.timedOut ? "still running after the wait" : "finished";
  return {
    ok: !waited.timedOut ? waited.job.status === "exited" : true,
    output: `${jobLine(view)} (${state})\n\n${tail(waited.job.log, lines)}`,
    ...(waited.timedOut || waited.job.status === "exited"
      ? {}
      : { error: waited.job.error ?? `Job ${view.id} ${view.status}` }),
    data: { kind: "jobs", job: view, waitTimedOut: waited.timedOut },
  };
}

async function waitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T | "aborted"> {
  if (signal.aborted) return "aborted";
  return new Promise((resolve) => {
    const abort = (): void => resolve("aborted");
    signal.addEventListener("abort", abort, { once: true });
    void work.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    });
  });
}
