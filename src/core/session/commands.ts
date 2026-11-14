import { jobView } from "../../tools/jobs/view";
import type { Command } from "../types";
import { mapLoopEvent } from "./loop-events";
import { sessionAttachments } from "./media";
import { invokeModuleSurface } from "./module-surface";
import { lastUsedTarget } from "./run-input";
import type { SessionRuntime } from "./runtime";

/** Answers every command except `run`, which the session handles itself. */
export async function dispatch(
  runtime: SessionRuntime,
  command: Exclude<Command, { type: "run" }>,
): Promise<unknown> {
  const { options, queue, steering, approvals, compaction } = runtime;
  switch (command.type) {
    case "modules.invoke":
      return invokeModuleSurface(runtime, command.input);
    case "stop": {
      if (command.target === "worker") return { stopped: false };
      const active = runtime.active();
      if (!active) return { stopped: false };
      if (command.mode === "graceful") active.stop.abort("stopped");
      else active.controller.abort("stopped");
      return { stopped: true, mode: command.mode ?? "force" };
    }
    case "queue.add": {
      const existing = command.id ? queue.list().find((item) => item.id === command.id) : undefined;
      if (existing) return { item: existing, queue: queue.list() };
      const sessionId = runtime.reserveSessionId();
      const loaded =
        command.attachments?.length && options.saveMedia
          ? await sessionAttachments(command.attachments, sessionId, options)
          : undefined;
      const item = queue.add(
        command.text,
        command.mode ?? "queue",
        command.attachments,
        command.id,
        command.contexts,
        loaded ? { media: loaded.media, blocks: loaded.blocks } : undefined,
      );
      if (item.mode === "steer" && item.state === "pending") steering.push(item);
      await runtime.saveQueue();
      return { item, queue: queue.list() };
    }
    case "queue.edit": {
      const item = queue.edit(command.id, command.text);
      if (item.mode === "steer") steering.push(item);
      await runtime.saveQueue();
      return { item, queue: queue.list() };
    }
    case "queue.remove": {
      const removed = queue.remove(command.id);
      const cancelled = { ...removed, state: "cancelled" as const };
      steering.push(cancelled);
      await runtime.saveQueue();
      return { item: cancelled, queue: queue.list() };
    }
    case "approval.respond":
      return approvals.respond(command.id, command.decision, command.feedback);
    case "approval.allowAll":
      return Promise.all(command.ids.map((id) => approvals.respond(id, "allow_once"))).then(
        (results) => results.flatMap((result) => result ?? []),
      );
    case "approval.denyAll":
      return Promise.all(command.ids.map((id) => approvals.respond(id, "deny"))).then((results) =>
        results.flatMap((result) => result ?? []),
      );
    case "tool.cancel":
      return { cancelled: runtime.calls.cancel(command.callId) };
    case "subagent.stop":
      return { stopped: runtime.subagents.stop(command.id) };
    case "jobs.list":
      return { jobs: runtime.terminals.listJobs().map((job) => jobView(job.snapshot())) };
    case "jobs.stop": {
      const job = await runtime.terminals.stopJob(command.id);
      return { job: job ? jobView(job) : null };
    }
    case "checkpoint.list":
      return options.checkpoints?.list() ?? [];
    case "checkpoint.diff":
      return options.checkpoints?.diff(command.id);
    case "checkpoint.restore":
      return options.checkpoints?.restore(command.id, command.target ?? "before", {
        ...(command.force ? { force: true } : {}),
        ...(command.includeProtected ? { includeProtected: true } : {}),
        ...(command.paths && command.paths.length > 0 ? { paths: command.paths } : {}),
      });
    case "context.compact": {
      const request = command.focus ? { focus: command.focus } : {};
      if (runtime.active()) {
        compaction.schedule(request);
        return { scheduled: true };
      }
      const sessionId = runtime.sessionId();
      const history = runtime.history();
      if (sessionId === undefined || history.length === 0) return { compacted: false };
      const outcome = await compaction.compactIdle(sessionId, history, request, (event) =>
        runtime.emit(mapLoopEvent(event, sessionId)),
      );
      return {
        compacted: outcome.compacted,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        context: compaction.reading(sessionId, history),
      };
    }
    case "status":
      return status(runtime);
  }
}

/** The permission engine is shared by every task; a task reports only the calls it waits on. */
function ownApprovals(runtime: SessionRuntime) {
  const own = new Set(runtime.approvals.pendingIds());
  return (runtime.options.permissions?.pending() ?? []).filter((entry) => own.has(entry.id));
}

function status(runtime: SessionRuntime): Record<string, unknown> {
  const { options } = runtime;
  const active = runtime.active();
  const lastUsed = lastUsedTarget(options.provider);
  const sessionId = active?.sessionId ?? runtime.sessionId();
  return {
    sessionState: runtime.state(),
    running: runtime.busy(),
    sessionId,
    turns: active?.turns ?? 0,
    usage: active?.usage ?? { input: 0, output: 0, cached: 0 },
    ...(active ? { budget: active.budget.view() } : {}),
    provider: options.providerId,
    model: options.model,
    cwd: options.cwd,
    ...(lastUsed ? { lastUsed } : {}),
    ...(options.promptStamp ? { system: options.promptStamp } : {}),
    goal: runtime.goal()?.toStatus(),
    context: runtime.compaction.reading(sessionId, runtime.history()),
    queue: runtime.queue.list().filter((item) => item.state === "pending"),
    steering: runtime.steering.hasPending(),
    approvals: ownApprovals(runtime),
    calls: runtime.calls.running(),
    jobs: runtime.terminals.listJobs().map((job) => jobView(job.snapshot())),
  };
}
