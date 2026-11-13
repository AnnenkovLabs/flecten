import { z } from "zod";
import { ModuleHostCommandSchema } from "../../../../shared/module-interface";
import type { AgentEvent } from "../agent-protocol";
import { controlWindow, onAgentEvent, requestAgent } from "../desktop";
import type { RunStore } from "../run.svelte";
import { settings } from "../settings.svelte";

export interface ModuleHarness {
  snapshot(): unknown;
  session(): string;
  request(command: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
}
const RunInput = z.object({
  prompt: z.string().min(1).max(1_000_000),
  mode: z.enum(["queue", "steer"]).default("queue"),
  attachments: z.array(z.string()).max(32).default([]),
});

/** Custom shells use the same UI store, queue, session routing and sidecar as the native UI. */
export function moduleHarness(run: RunStore): ModuleHarness {
  return {
    session: () => run.ensureSession(),
    snapshot: () => ({
      apiVersion: 1,
      sessionId: run.activeTask === "current" ? null : run.activeTask,
      connection: run.connection,
      title: run.title,
      project: run.project,
      cwd: run.info?.cwd ?? "",
      running: run.busy,
      phase: run.view.phase,
      provider: run.provider,
      model: run.model,
      providers: run.info?.providers ?? [],
      sessions: run.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        running: run.isRunning(s.id),
      })),
      messages: run.view.thread.items.flatMap((item) => {
        if (item.kind === "message" || item.kind === "answer")
          return [
            { id: item.id, role: item.kind === "message" ? "user" : "assistant", text: item.text },
          ];
        return [];
      }),
      approvals: run.view.thread.items.filter(
        (item) => item.kind === "approval" && item.state === "pending",
      ),
      usage: run.view.usage,
      budget: run.view.budget,
      queue: run.view.queued,
      jobs: run.view.jobs,
    }),
    async request(raw) {
      const command = ModuleHostCommandSchema.parse(raw);
      switch (command.type) {
        case "run": {
          const input = RunInput.parse(command);
          if (!run.submit(input.prompt, input.mode, input.attachments))
            throw new Error("Task could not be submitted");
          return { sessionId: run.activeTask };
        }
        case "stop":
          run.stop();
          return { requested: true };
        case "sessions.new":
          run.newTask();
          return { created: true };
        case "sessions.select":
          await run.selectTask(z.string().min(1).parse(command.id));
          return { selected: run.activeTask };
        case "settings.open":
          await settings.openPanel();
          return { opened: true };
        case "window.control":
          controlWindow(z.enum(["minimize", "maximize", "close"]).parse(command.action));
          return { requested: true };
        case "model.set": {
          const input = z
            .object({ provider: z.string().min(1), model: z.string().min(1) })
            .parse(command);
          await run.setModel(input.provider, input.model);
          return { provider: run.provider, model: run.model };
        }
        default:
          // Every other command retains the existing sidecar validation and permissions.
          return requestAgent(command as Parameters<typeof requestAgent>[0]);
      }
    },
    subscribe(listener) {
      return onAgentEvent((event: AgentEvent) => {
        if ("sessionId" in event && event.sessionId === run.activeTask) listener(event);
      });
    },
  };
}
