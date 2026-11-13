import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_TYPES,
  createHandlers,
  isCommandType,
  isSessionId,
} from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";
import type { Command } from "../../src/core/types";

function fakeApp(sent: Command[]): AppService {
  const session = {
    send: async (command: Command) => {
      sent.push(command);
      return command.type === "context.compact" ? { compacted: true } : { ok: true };
    },
  };
  return {
    session,
    listCommands: async () => [{ name: "ship", source: "command" }],
  } as unknown as AppService;
}

describe("sidecar command handlers", () => {
  test("the shell allowlist and the server handle exactly the same commands", () => {
    const allowlist = JSON.parse(
      readFileSync(join(import.meta.dir, "../../shell/agent-commands.json"), "utf8"),
    ) as string[];
    expect([...allowlist].sort()).toEqual([...COMMAND_TYPES].sort());
    expect(isCommandType("context.compact")).toBe(true);
    expect(isCommandType("eval")).toBe(false);
    expect(isCommandType("plugins.list")).toBe(false);
    expect(isCommandType("plugins.change")).toBe(false);
    expect(isCommandType("modules.list")).toBe(true);
  });

  test("session ids are file-safe names", () => {
    expect(isSessionId("s_abc-123")).toBe(true);
    expect(isSessionId("../etc")).toBe(false);
    expect(isSessionId("")).toBe(false);
    expect(isSessionId("a b")).toBe(false);
  });

  test("compact passes a trimmed focus and returns the session reply", async () => {
    const sent: Command[] = [];
    const handlers = createHandlers(fakeApp(sent), () => undefined);
    expect(
      await handlers["context.compact"]({ type: "context.compact", focus: "  auth flow  " }),
    ).toEqual({
      compacted: true,
    });
    expect(sent[0]).toEqual({ type: "context.compact", focus: "auth flow" });
    await handlers["context.compact"]({ type: "context.compact", focus: "   " });
    expect(sent[1]).toEqual({ type: "context.compact" });
  });

  test("commands.list returns slash entries", async () => {
    const handlers = createHandlers(fakeApp([]), () => undefined);
    expect(await handlers["commands.list"]({ type: "commands.list" })).toEqual({
      commands: [{ name: "ship", source: "command" }],
    });
  });

  test("stop validates its mode and returns the canonical state", async () => {
    const sent: Command[] = [];
    const handlers = createHandlers(fakeApp(sent), () => undefined);
    expect(() => handlers.stop({ type: "stop", mode: "unknown" })).toThrow("invalid stop mode");
    expect(await handlers.stop({ type: "stop", mode: "graceful" })).toEqual({
      result: { ok: true },
      state: { ok: true },
    });
    expect(sent).toEqual([{ type: "stop", mode: "graceful" }, { type: "status" }]);
  });

  test("validation errors are thrown with a readable message", async () => {
    const handlers = createHandlers(fakeApp([]), () => undefined);
    expect(() => handlers.run({ type: "run", prompt: "   " })).toThrow("prompt is required");
    expect(() => handlers.run({ type: "run", prompt: "hi", sessionId: "../x" })).toThrow(
      "sessionId is invalid",
    );
    await expect(
      Promise.resolve().then(() =>
        handlers["sessions.delete"]({ type: "sessions.delete", id: "s1" }),
      ),
    ).rejects.toThrow("confirm: true is required");
    expect(() =>
      handlers["approval.respond"]({ type: "approval.respond", id: "a1", decision: "maybe" }),
    ).toThrow("invalid approval decision");
  });

  test("run starts without a response and reports late failures as events", async () => {
    const errors: string[] = [];
    const app = {
      session: { send: async () => Promise.reject(new Error("a run is already active")) },
    } as unknown as AppService;
    const handlers = createHandlers(app, (message) => errors.push(message));
    expect(handlers.run({ type: "run", prompt: "hi", attachments: ["a.png", 3] })).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(["a run is already active"]);
  });
});

test("Worker stop target is explicit and validated at the protocol boundary", async () => {
  const sent: Command[] = [];
  const handlers = createHandlers(fakeApp(sent), () => undefined);
  expect(() => handlers.stop({ type: "stop", target: "all-models" })).toThrow(
    "invalid stop target",
  );
  await handlers.stop({ type: "stop", target: "worker", mode: "force" });
  expect(sent[0]).toEqual({ type: "stop", target: "worker", mode: "force" });
});
