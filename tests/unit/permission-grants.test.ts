import { describe, expect, test } from "bun:test";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event } from "../../src/core/types";
import { permissionRequestKey } from "../../src/security/permission-request-key";
import { PermissionEngine } from "../../src/security/permissions";
import type { PermissionRequest } from "../../src/security/types";

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  action: "shell",
  tool: "bash",
  cwd: "/workspace",
  sessionId: "chat-a",
  target: "echo hello",
  args: { command: "echo hello" },
  safety: "unbounded",
  ...overrides,
});
function ask(engine: PermissionEngine, input = request()): string {
  const decision = engine.decide(input);
  if (!decision.approvalId) throw new Error(`Expected approval, got ${decision.policy}`);
  return decision.approvalId;
}

describe("precise permission grants", () => {
  test("a project grant binds command, arguments, working directory and risk set", () => {
    const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    engine.approve(ask(engine), "allow_always");
    expect(engine.check(request()).policy).toBe("allow");
    for (const changed of [
      request({ args: { command: "echo goodbye" } }),
      request({ cwd: "/other" }),
      request({ actor: "another-agent" }),
      request({ args: { command: "echo hello", background: true } }),
      request({ risks: [{ id: "force-push", label: "force", detail: "irreversible" }] }),
    ])
      expect(engine.check(changed).policy).toBe("ask");
  });
  test("MCP grants do not authorize different arguments or another tool", () => {
    const engine = new PermissionEngine();
    const call = request({
      action: "mcp",
      tool: "mcp_server_send",
      args: { recipient: "a", body: "hello" },
    });
    engine.approve(ask(engine, call), "allow_always");
    expect(engine.check(call).policy).toBe("allow");
    expect(engine.check({ ...call, args: { recipient: "b", body: "hello" } }).policy).toBe("ask");
    expect(engine.check({ ...call, tool: "mcp_server_delete" }).policy).toBe("ask");
  });
  test("session grants never reach another chat or persistence", () => {
    const saved: unknown[] = [];
    const engine = new PermissionEngine({
      onRemember: (rule) => {
        saved.push(rule);
      },
    });
    engine.approve(ask(engine), "allow_session");
    expect(engine.check(request()).policy).toBe("allow");
    expect(engine.check(request({ sessionId: "chat-b" })).policy).toBe("ask");
    const { sessionId: _sessionId, ...withoutSession } = request();
    expect(engine.check(withoutSession).policy).toBe("ask");
    expect(saved).toEqual([]);
  });
  test("mandatory deny wins over a specific persisted allow and every resource is checked", () => {
    const call = request({
      action: "write",
      tool: "move",
      path: "public/a",
      paths: ["/workspace/public/a", "/workspace/private/b"],
    });
    const engine = new PermissionEngine({
      rules: [
        { action: "write", policy: "deny", pathPrefix: "private" },
        { action: "write", policy: "allow", requestKey: permissionRequestKey(call), tool: "move" },
      ],
    });
    expect(engine.check(call).policy).toBe("deny");
  });
  test("risk allow respects its path and a broad deny cannot be bypassed", () => {
    const engine = new PermissionEngine({
      rules: [
        { action: "shell", policy: "allow" },
        { action: "shell", risk: "destroy", policy: "allow", pathPrefix: "safe" },
      ],
    });
    const risks = [{ id: "destroy", label: "Delete", detail: "No rollback" }];
    expect(engine.check(request({ path: "safe/a", risks })).policy).toBe("allow");
    expect(engine.check(request({ path: "other/a", risks })).policy).toBe("ask");
  });
  test("auto cannot approve opaque code or third-party metadata", () => {
    const engine = new PermissionEngine({
      rules: [
        { action: "shell", policy: "auto" },
        { action: "read", policy: "auto" },
      ],
    });
    expect(engine.check(request()).policy).toBe("ask");
    expect(engine.check(request({ action: "read", tool: "read", safety: "bounded" })).policy).toBe(
      "auto",
    );
  });
  test("live rule changes invalidate session grants and pending allows", () => {
    const engine = new PermissionEngine();
    engine.approve(ask(engine), "allow_session");
    const id = ask(engine, request({ args: { command: "echo later" } }));
    engine.replaceRules({ rules: [{ action: "shell", policy: "deny" }] });
    expect(engine.check(request()).policy).toBe("deny");
    expect(engine.approve(id, "allow_once")?.choice).toBe("deny");
  });
  test("pending requests are snapshots and argument key order is canonical", () => {
    const engine = new PermissionEngine();
    const call = request();
    const id = ask(engine, call);
    if (call.args) call.args.command = "changed";
    const pending = engine.pending();
    if (pending[0]?.request.args) pending[0].request.args.command = "also changed";
    expect(engine.approve(id, "allow_once")?.request.args?.command).toBe("echo hello");
    expect(permissionRequestKey(request({ args: { a: 1, b: { x: 2, y: 3 } } }))).toBe(
      permissionRequestKey(request({ args: { b: { y: 3, x: 2 }, a: 1 } })),
    );
  });
});

describe("approval persistence and receipts", () => {
  test("the tool stays blocked until the exact grant is durably saved", async () => {
    let release: () => void = () => {};
    const engine = new PermissionEngine({
      onRemember: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const events: Event[] = [];
    const waiters = new ApprovalWaiters({
      permissions: () => engine,
      emit: (event) => events.push(event),
      timeoutMs: () => 1000,
    });
    const id = ask(engine);
    const waiting = waiters
      .gate("chat-a")
      .wait({ id, request: request(), reason: "test" }, new AbortController().signal);
    const responding = waiters.respond(id, "allow_always");
    expect(events.some((event) => event.type === "approval.resolved")).toBe(false);
    release();
    expect((await waiting).choice).toBe("allow_always");
    await responding;
    expect(waiters.resolutions()).toEqual([{ id, choice: "allow_always", by: "user" }]);
    expect(await waiters.respond(id, "allow_once")).toBeUndefined();
  });
  test("save failure denies execution and does not install a project grant", async () => {
    const engine = new PermissionEngine({
      onRemember: async () => {
        throw new Error("disk full");
      },
    });
    const waiters = new ApprovalWaiters({
      permissions: () => engine,
      emit: () => {},
      timeoutMs: () => 1000,
    });
    const id = ask(engine);
    const waiting = waiters
      .gate("chat-a")
      .wait({ id, request: request(), reason: "test" }, new AbortController().signal);
    await expect(waiters.respond(id, "allow_always")).rejects.toThrow("disk full");
    expect(await waiting).toEqual({ choice: "deny", by: "persistence" });
    expect(engine.check(request()).policy).toBe("ask");
    expect(engine.pending()).toEqual([]);
  });
});

describe("delegated approval ownership", () => {
  test("child requests route through the parent and grants remain bounded by parent deny", async () => {
    const parent = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    const child = new PermissionEngine({ rules: [{ action: "shell", policy: "allow" }] }, parent);
    const events: Event[] = [];
    const waiters = new ApprovalWaiters({
      permissions: () => parent,
      emit: (event) => events.push(event),
      timeoutMs: () => 1000,
    });
    const operation = request({ actor: "researcher" });
    const id = ask(child, operation);
    const waiting = waiters
      .gate("chat-a")
      .wait({ id, request: operation, reason: "parent asks" }, new AbortController().signal, child);
    expect(parent.pending()).toEqual([]);
    const feedback = "  Keep the user text exactly.\nChoose a local operation.  ";
    await waiters.respond(id, "allow_session", feedback);
    expect(await waiting).toEqual({ choice: "allow_session", by: "user", feedback });
    expect(child.check(operation).policy).toBe("allow");
    expect(parent.check(operation).policy).toBe("allow");
    expect(parent.check({ ...operation, sessionId: "other" }).policy).toBe("ask");
    expect(events.find((event) => event.type === "approval.requested")?.type).toBe(
      "approval.requested",
    );
    parent.replaceRules({ rules: [{ action: "shell", policy: "deny" }] });
    expect(child.check(operation).policy).toBe("deny");
  });
});
