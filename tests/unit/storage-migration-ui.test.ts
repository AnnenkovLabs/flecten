import { afterEach, expect, test } from "bun:test";
import type { StorageMigrationState } from "../../shared/storage-migration";
import { RunStore } from "../../ui/src/lib/run.svelte";
import { toast } from "../../ui/src/lib/toast.svelte";
import type { AgentCommand, AgentEvent, AgentInfo } from "../../ui/src/lib/types";

const originalWindow = globalThis.window;
let disconnect: (() => void) | undefined;
afterEach(() => {
  disconnect?.();
  disconnect = undefined;
  toast.dispose();
  globalThis.window = originalWindow;
});

const required: StorageMigrationState = {
  version: 1,
  phase: "required",
  step: "inspect",
  completed: 0,
  total: 1,
  paths: ["/project"],
  backups: [],
};
const info: AgentInfo = {
  cwd: "/project",
  project: "Project",
  user: "User",
  branch: "main",
  provider: "test",
  model: "test",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  providers: [],
};

function harness() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const calls: AgentCommand[] = [];
  const pending: Extract<AgentCommand, { requestId: string }>[] = [];
  let current: StorageMigrationState = required;
  let migrations = 0;
  const emit = (event: AgentEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const reply = (command: { requestId: string }, fields = {}) =>
    emit({ type: "response", ok: true, requestId: command.requestId, ...fields });
  const target = Object.assign(new EventTarget(), {
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          calls.push(command);
          if (command.type === "hello") emit({ type: "storage.migration", migration: current });
          else if (command.type === "storage.migrate") {
            migrations += 1;
            current = {
              ...required,
              phase: migrations === 1 ? "failed" : "complete",
              ...(migrations === 1 ? { error: "Disk full" } : {}),
            };
            emit({ type: "storage.migration", migration: current });
            reply(command);
          } else if (command.type === "storage.accept") pending.push(command);
          else if ("requestId" in command) reply(command);
        },
      },
    },
  });
  globalThis.window = target as unknown as Window & typeof globalThis;
  const run = new RunStore();
  disconnect = run.connect();
  return { run, calls, pending, emit, reply };
}

test("migration gates startup, retries on demand and waits for runtime status after Continue", async () => {
  const h = harness();
  expect(h.calls.map((command) => command.type)).toEqual(["hello"]);
  expect(h.run.connection).toBe("connecting");
  expect(h.run.migration.snapshot?.phase).toBe("required");
  expect(h.run.start("keep chats safe")).toBe(false);
  expect(h.calls.some((command) => command.type === "run")).toBe(false);
  await h.run.refreshSessions();
  await h.run.loadCommands();
  expect(h.calls).toHaveLength(1);

  await h.run.migration.start();
  expect(h.run.migration.snapshot).toMatchObject({ phase: "failed", error: "Disk full" });
  await h.run.migration.start();
  expect(h.run.migration.snapshot?.phase).toBe("complete");
  const accepted = h.run.migration.accept();
  const command = h.pending.shift();
  if (!command) throw new Error("Missing acceptance request");
  h.reply(command);
  await accepted;
  expect(h.run.migration.snapshot?.phase).toBe("complete");
  expect(h.run.connection).toBe("connecting");

  h.emit({ type: "status", ...info });
  await Bun.sleep(1);
  expect(h.run.migration.snapshot).toBeNull();
  expect(h.run.connection).toBe("ready");
  for (const type of ["sessions.list", "projects.list", "checkpoint.list", "commands.list"]) {
    expect(h.calls.filter((call) => call.type === type)).toHaveLength(1);
  }
  h.emit({ type: "status", ...info });
  expect(h.calls.filter((call) => call.type === "sessions.list")).toHaveLength(1);
  expect(h.run.view.thread.items).toEqual([]);

  const previous = h.calls.length;
  h.emit({ type: "project.changed", cwd: "/other-project" });
  expect(h.run.connection).toBe("connecting");
  expect(h.calls).toHaveLength(previous);
  h.emit({ type: "storage.migration", migration: required });
  expect(h.run.migration.snapshot?.phase).toBe("required");
  h.emit({ type: "status", ...info, cwd: "/other-project" });
  await Bun.sleep(1);
  expect(h.run.migration.snapshot).toBeNull();
  expect(h.calls.filter((call) => call.type === "sessions.list")).toHaveLength(2);
});

test("migration progress survives startup failure and is replaced by the next typed snapshot", () => {
  const h = harness();
  h.emit({
    type: "storage.migration",
    migration: { ...required, phase: "running", step: "backup" },
  });
  h.emit({ type: "agent.exit", code: 1 });
  expect(h.run.migration.snapshot).toMatchObject({ phase: "failed", step: "backup" });
  h.emit({
    type: "storage.migration",
    migration: { ...required, phase: "failed", error: "Retry" },
  });
  expect(h.run.migration.snapshot).toMatchObject({ phase: "failed", error: "Retry" });
  expect(h.run.view.thread.items).toEqual([]);
});
