import { type SubagentInfo, subagentIdentity } from "../../../shared/subagents";
import type { SubagentInvocation } from "../../tools/task/run";
import type { Event } from "../types";
import { emptyUsage } from "../types/message";
import type { SubagentRunResult } from "./types";

interface Task {
  info: SubagentInfo;
  controller: AbortController;
  promise: Promise<SubagentRunResult>;
  result?: SubagentRunResult;
}

/** Children belong to the chat, independently of any individual parent run. */
export class SubagentTasks {
  readonly #tasks = new Map<string, Task>();
  constructor(private readonly emit: (event: Event) => void) {}

  get running(): number {
    return [...this.#tasks.values()].filter((task) => !task.result).length;
  }

  start(
    input: { agent: string; prompt: string; context?: string | undefined },
    invocation: SubagentInvocation,
    sessionId: string,
    callId: string,
  ): Task {
    const info: SubagentInfo = {
      id: `sa_${crypto.randomUUID()}`,
      callId,
      ...subagentIdentity(this.#tasks.size),
      agent: input.agent,
      prompt: input.prompt,
    };
    const controller = new AbortController();
    const task: Task = {
      info,
      controller,
      promise: Promise.resolve({ ok: false, summary: "", usage: emptyUsage() }),
    };
    this.#tasks.set(info.id, task);
    this.emit({ type: "subagent.started", sessionId, subagent: info });
    const timer = setTimeout(() => controller.abort("Subagent time limit reached"), 30 * 60_000);
    task.promise = invocation.runner
      .run(input.agent, input.prompt, {
        runChild: invocation.runChild,
        signal: controller.signal,
        ...(input.context === undefined ? {} : { parentContext: input.context }),
        onEvent: (event) => this.emit({ type: "subagent.event", sessionId, id: info.id, event }),
      })
      .catch(
        (error: unknown): SubagentRunResult => ({
          ok: false,
          summary: "",
          usage: emptyUsage(),
          error: String(error),
        }),
      )
      .then((result) => {
        clearTimeout(timer);
        task.result = result;
        this.emit({
          type: "subagent.finished",
          sessionId,
          id: info.id,
          result,
          cancelled: controller.signal.aborted,
        });
        return result;
      });
    return task;
  }

  list() {
    return [...this.#tasks.values()].map((task) => ({
      ...task.info,
      state: task.result
        ? task.controller.signal.aborted
          ? "stopped"
          : task.result.ok
            ? "succeeded"
            : "failed"
        : "running",
      ...(task.result ? { result: task.result } : {}),
    }));
  }
  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
  stop(id: string): boolean {
    const task = this.#tasks.get(id);
    if (!task || task.result || task.controller.signal.aborted) return false;
    task.controller.abort("Subagent stopped explicitly");
    return true;
  }
  async dispose(): Promise<void> {
    for (const id of this.#tasks.keys()) this.stop(id);
    await Promise.allSettled([...this.#tasks.values()].map((task) => task.promise));
  }
}
