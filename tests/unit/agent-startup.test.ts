import { expect, test } from "bun:test";

const { AgentStartup } = require("../../shell/agent-startup.mjs") as {
  AgentStartup: new () => {
    note(message: unknown): void;
    reset(): void;
    route(command: { type: string; requestId?: string }): {
      action: "send" | "restart" | "blocked";
      response?: unknown;
    };
  };
};

test("a locked project blocks background restarts while answering pending requests", () => {
  const startup = new AgentStartup();
  startup.note({ type: "error", code: "project_locked", message: "Project already open" });
  for (let cycle = 0; cycle < 5; cycle++) {
    expect(startup.route({ type: "status" })).toEqual({ action: "blocked" });
    expect(startup.route({ type: "modules.list", requestId: `poll-${cycle}` })).toEqual({
      action: "blocked",
      response: {
        type: "response",
        requestId: `poll-${cycle}`,
        ok: false,
        error: "Project already open",
      },
    });
  }
});

test("explicit retry and new tasks can restart, and changing projects clears the lock", () => {
  const startup = new AgentStartup();
  for (const type of ["hello", "run"]) {
    startup.note({ type: "error", code: "project_locked", message: "Project already open" });
    expect(startup.route({ type }).action).toBe("restart");
    expect(startup.route({ type: "status" }).action).toBe("send");
  }
  startup.note({ type: "error", code: "project_locked", message: "Project already open" });
  startup.reset();
  expect(startup.route({ type: "modules.list" }).action).toBe("send");
  startup.note({ type: "error", code: "startup_failed", message: "Transient failure" });
  expect(startup.route({ type: "hello" }).action).toBe("send");
});
