import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const { watchAgentOutput } = require("../../shell/agent-output.mjs") as {
  watchAgentOutput(
    child: EventEmitter & { stdout: PassThrough; stderr: PassThrough },
    handlers: {
      current(): boolean;
      message(value: unknown): void;
      stderr(value: string): void;
      invalid(): void;
      exited(code: number, signal: string): void;
      failed(error: Error): void;
    },
  ): () => void;
};

test("replaced child cannot deliver buffered stdout, stderr or exit callbacks", () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  let current = true;
  const messages: unknown[] = [];
  const close = watchAgentOutput(child, {
    current: () => current,
    message: (value) => messages.push(value),
    stderr: (value) => messages.push(value),
    invalid: () => messages.push("invalid"),
    exited: () => messages.push("exit"),
    failed: () => messages.push("error"),
  });
  child.stdout.write('{"type":"status","cwd":"current"}\n');
  expect(messages).toEqual([{ type: "status", cwd: "current" }]);
  current = false;
  child.stdout.write('{"type":"status","cwd":"previous"}\ninvalid\n');
  child.stderr.write("previous stderr\n");
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  child.emit("error", new Error("previous error"));
  expect(messages).toEqual([{ type: "status", cwd: "current" }]);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
  close();
  child.stdout.destroy();
  child.stderr.destroy();
});

test("a final startup error is drained before the process exit reaches the renderer", () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const messages: unknown[] = [];
  const close = watchAgentOutput(child, {
    current: () => true,
    message: (value) => messages.push(value),
    stderr() {},
    invalid() {},
    exited: () => messages.push("exit"),
    failed() {},
  });
  child.emit("exit", 1, null);
  child.stdout.write('{"type":"error","code":"project_locked"}\n');
  child.emit("close", 1, null);
  expect(messages).toEqual([{ type: "error", code: "project_locked" }, "exit"]);
  close();
  child.stdout.destroy();
  child.stderr.destroy();
});

test("closing a child reader detaches both streams before replacement", () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const messages: unknown[] = [];
  const close = watchAgentOutput(child, {
    current: () => true,
    message: (value) => messages.push(value),
    stderr: (value) => messages.push(value),
    invalid: () => messages.push("invalid"),
    exited() {},
    failed() {},
  });
  close();
  child.stdout.write('{"type":"status"}\n');
  child.stderr.write("old stderr\n");
  expect(messages).toEqual([]);
  expect(child.stdout.listenerCount("data")).toBe(0);
  expect(child.stderr.listenerCount("data")).toBe(0);
  child.stdout.destroy();
  child.stderr.destroy();
});
