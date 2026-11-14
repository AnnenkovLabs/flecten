import { afterEach, expect, test } from "bun:test";
import type { AgentCommand, AgentEvent, AgentJob } from "../../ui/src/lib/types";
import "../helpers/svelte-runes";

const { TaskCommands, TaskView, toast } = await import("../fixtures/session-state-ui");
const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
  toast.dispose();
});

test("delayed task replies belong to the view generation that requested them", async () => {
  const listeners = new Set<(event: AgentEvent) => void>();
  let sent: AgentCommand | undefined;
  globalThis.window = {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          sent = command;
        },
      },
    },
  } as unknown as Window & typeof globalThis;
  const view = new TaskView({ checkpointSaved() {} });
  let sessionId = "A";
  const commands = new TaskCommands(view, () => sessionId);
  const reply = (data: object) => {
    if (!sent || !("requestId" in sent)) throw new Error("request missing");
    for (const listener of listeners)
      listener({ type: "response", requestId: sent.requestId, ok: true, ...data } as AgentEvent);
  };
  const job: AgentJob = {
    id: "job-from-A",
    command: "sleep 10",
    cwd: "/A",
    status: "stopped",
    startedAt: 1,
    pid: null,
    finishedAt: 2,
    durationMs: 1,
    exitCode: null,
    signal: "SIGTERM",
    timedOut: false,
    logBytes: 0,
    error: null,
  };
  for (const returnedToA of [false, true]) {
    sessionId = "A";
    const stopping = commands.stopJob("job-from-A");
    sessionId = "B";
    view.reset();
    if (returnedToA) sessionId = "A";
    reply({ job });
    await stopping;
    expect(view.jobs).toEqual([]);
  }
  const compacting = commands.compact();
  view.reset();
  reply({ context: { used: 1234, window: 10000, reserve: 1000 }, compacted: true });
  await compacting;
  expect(view.context.used).toBe(0);
  const stopping = commands.stopJob("job-from-A");
  reply({ job });
  await stopping;
  expect(view.jobs).toEqual([job]);
});
