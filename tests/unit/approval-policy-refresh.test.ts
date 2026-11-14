import { expect, spyOn, test } from "bun:test";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import type { PermissionRequest } from "../../src/security/types";

function approvalId(engine: PermissionEngine, request: PermissionRequest): string {
  const id = engine.decide(request).approvalId;
  if (!id) throw new Error("Expected a pending approval");
  return id;
}

test("changing access releases an existing waiter and publishes the actual policy outcome", async () => {
  const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
  const events: Event[] = [];
  const waiters = new ApprovalWaiters({
    permissions: () => engine,
    timeoutMs: () => 1000,
    emit: (event) => events.push(event),
  });
  const request: PermissionRequest = {
    action: "shell",
    tool: "bash",
    cwd: "/work",
    sessionId: "chat",
  };
  const id = approvalId(engine, request);
  const result = waiters
    .gate("chat")
    .wait({ id, request, reason: "test" }, new AbortController().signal);
  engine.replaceRules({ rules: [{ action: "shell", policy: "allow" }] });
  expect(await result).toEqual({ choice: "allow_once", by: "policy" });
  expect(waiters.pending()).toHaveLength(0);
  expect(engine.pending()).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({
    type: "approval.resolved",
    choice: "allow_once",
    by: "policy",
  });
});

test("a covering chat directory grant releases another pending tool but preserves checkpoints", async () => {
  const engine = new PermissionEngine({ rules: [{ action: "external_path", policy: "ask" }] });
  const waiters = new ApprovalWaiters({
    permissions: () => engine,
    timeoutMs: () => 1000,
    emit: () => {},
  });
  const controller = new AbortController();
  const request: PermissionRequest = {
    action: "external_path",
    tool: "read",
    cwd: "/work",
    path: "/reference",
    sessionId: "chat",
    safety: "bounded",
  };
  const first = approvalId(engine, request);
  const secondRequest = { ...request, tool: "grep", path: "/reference/nested" };
  const second = approvalId(engine, secondRequest);
  const firstResult = waiters
    .gate("chat")
    .wait({ id: first, request, reason: "test" }, controller.signal);
  const secondResult = waiters
    .gate("chat")
    .wait({ id: second, request: secondRequest, reason: "test" }, controller.signal);
  await waiters.respond(first, "allow_session");
  expect(await firstResult).toMatchObject({ choice: "allow_session", by: "user" });
  expect(await secondResult).toMatchObject({ choice: "allow_once", by: "policy" });
  engine.replaceRules({ rules: [{ action: "external_path", policy: "ask", checkpoint: true }] });
  const third = approvalId(engine, request);
  const thirdResult = waiters
    .gate("chat")
    .wait({ id: third, request, reason: "test" }, controller.signal);
  engine.replaceRules({
    rules: [
      { action: "external_path", policy: "allow" },
      { action: "external_path", policy: "ask", checkpoint: true },
    ],
  });
  expect(waiters.pending()).toHaveLength(1);
  controller.abort();
  expect(await thirdResult).toEqual({ choice: "deny", by: "aborted" });
});

test("a child folder grant releases covering parent and sibling waiters, then revokes their mounts", async () => {
  const rules = [{ action: "external_path" as const, policy: "ask" as const }];
  const parent = new PermissionEngine({ rules });
  const child = new PermissionEngine({ rules }, parent);
  const sibling = new PermissionEngine({ rules }, parent);
  const waiters = new ApprovalWaiters({
    permissions: () => parent,
    timeoutMs: () => 1000,
    emit: () => {},
  });
  const request: PermissionRequest = {
    action: "external_path",
    tool: "read",
    path: "/reference",
    cwd: "/work",
    sessionId: "chat",
    safety: "bounded",
  };
  const controllers = [parent, child, sibling].map((engine) => {
    const id = approvalId(engine, request);
    return {
      id,
      result: waiters
        .gate("chat")
        .wait({ id, request, reason: "test" }, new AbortController().signal, engine),
    };
  });
  const childWaiter = controllers[1];
  if (!childWaiter) throw new Error("Child waiter missing");
  await waiters.respond(childWaiter.id, "allow_session");
  expect(await Promise.all(controllers.map(({ result }) => result))).toEqual([
    { choice: "allow_once", by: "policy" },
    { choice: "allow_session", by: "user" },
    { choice: "allow_once", by: "policy" },
  ]);
  expect(child.externalRoots("chat", "/work")).toEqual(["/reference"]);
  parent.replaceRules({ rules });
  expect(child.check(request).policy).toBe("ask");
  expect(child.externalRoots("chat", "/work")).toEqual([]);
});

test("policy changes cannot approve a request at its deadline", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(1000);
  try {
    const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    const waiters = new ApprovalWaiters({
      permissions: () => engine,
      timeoutMs: () => 1000,
      emit: () => {},
    });
    const request: PermissionRequest = {
      action: "shell",
      tool: "bash",
      cwd: "/work",
      sessionId: "chat",
    };
    const id = approvalId(engine, request);
    const result = waiters
      .gate("chat")
      .wait({ id, request, reason: "test" }, new AbortController().signal);
    clock.mockReturnValue(2000);
    engine.replaceRules({ rules: [{ action: "shell", policy: "allow" }] });
    expect(await result).toEqual({ choice: "deny", by: "timeout" });
    expect(waiters.pending()).toEqual([]);
    expect(engine.pending()).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});
