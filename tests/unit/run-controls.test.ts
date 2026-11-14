import { afterEach, expect, test } from "bun:test";
import { SessionStateSchema } from "../../shared/session-state";
import type { AgentCommand, AgentEvent } from "../../ui/src/lib/types";
import "../helpers/svelte-runes";

const { RunControls, RUN_CONTROL_COOLDOWN_MS } = await import(
  "../../ui/src/lib/run/controls.svelte"
);
const { TaskView } = await import("../fixtures/session-state-ui");
const originalWindow = globalThis.window;
const controls: InstanceType<typeof RunControls>[] = [];
afterEach(() => {
  for (const control of controls.splice(0)) control.dispose();
  globalThis.window = originalWindow;
});

function setup() {
  const view = new TaskView({ checkpointSaved() {} });
  const state = SessionStateSchema.parse({
    sessionId: "task",
    epoch: "core",
    revision: 1,
    phase: "running",
    running: true,
    interrupted: false,
    turns: 1,
    queue: [],
    approvals: [],
    jobs: [],
  });
  view.applyState(state);
  const commands: AgentCommand[] = [];
  const listeners = new Set<(event: AgentEvent) => void>();
  globalThis.window = {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          commands.push(command);
          if (!("requestId" in command)) return;
          for (const listener of listeners)
            listener({ type: "response", requestId: command.requestId, ok: true });
        },
      },
    },
  } as unknown as Window & typeof globalThis;
  let online = true;
  const prompts: string[] = [];
  const control = new RunControls(
    view,
    () => "task",
    () => online,
    (prompt) => {
      prompts.push(prompt);
      view.begin(prompt);
      return true;
    },
  );
  controls.push(control);
  return { view, state, commands, prompts, control, offline: () => (online = false) };
}

test("stop protects the force-stop transition, then permits force stop", async () => {
  const { view, state, control, commands } = setup();
  control.stop();
  view.applyState({ ...state, revision: 2, stopRequested: true });
  control.stop();
  expect(control.coolingDown).toBe(true);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ type: "stop", mode: "graceful", sessionId: "task" });
  await Bun.sleep(RUN_CONTROL_COOLDOWN_MS + 20);
  expect(control.coolingDown).toBe(false);
  control.stop();
  expect(commands[1]).toMatchObject({ type: "stop", mode: "force" });
});

test("stop-to-continue and continue-to-stop share one cooldown", async () => {
  const { view, state, control, commands, prompts } = setup();
  control.stop();
  view.applyState({ ...state, revision: 2, running: false, phase: "stopped" });
  expect(control.canContinue).toBe(true);
  expect(control.continue()).toBe(false);
  await Bun.sleep(RUN_CONTROL_COOLDOWN_MS + 20);
  expect(control.continue()).toBe(true);
  expect(control.continue()).toBe(false);
  control.stop();
  expect(prompts).toEqual(["/continue"]);
  expect(commands).toHaveLength(1);
  expect(control.canContinue).toBe(false);
  await Bun.sleep(RUN_CONTROL_COOLDOWN_MS + 20);
  control.stop();
  expect(commands).toHaveLength(2);
});

test("recovered task can continue only when the core is available", () => {
  const { view, state, control, prompts, offline } = setup();
  view.applyState({ ...state, revision: 2, running: false, phase: "stopped", interrupted: true });
  expect(control.canContinue).toBe(true);
  offline();
  expect(control.canContinue).toBe(false);
  expect(control.continue()).toBe(false);
  expect(prompts).toEqual([]);
});
