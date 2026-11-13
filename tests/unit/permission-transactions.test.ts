import { describe, expect, test } from "bun:test";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import type {
  PermissionEngineOptions,
  PermissionRequest,
  PermissionRule,
} from "../../src/security/types";

const operation: PermissionRequest = {
  action: "shell",
  tool: "bash",
  cwd: "/workspace",
  sessionId: "chat-a",
  args: { command: "git push --force origin main" },
  target: "git push --force origin main",
  safety: "unbounded",
  risks: [{ id: "git-push-force", label: "Force push", detail: "No undo" }],
};

function fixture(onRemember: PermissionEngineOptions["onRemember"], parent?: PermissionEngine) {
  const engine = new PermissionEngine(
    { ...(onRemember ? { onRemember } : {}), rules: [{ action: "shell", policy: "ask" }] },
    parent,
  );
  const events: Event[] = [];
  const waiters = new ApprovalWaiters({
    permissions: () => engine,
    emit: (event) => events.push(event),
    timeoutMs: () => 1000,
  });
  const controller = new AbortController();
  const id = engine.decide(operation).approvalId;
  if (!id) throw new Error("Expected approval");
  const outcome = waiters
    .gate("chat-a")
    .wait({ id, request: operation, reason: "test" }, controller.signal);
  return { engine, events, waiters, controller, id, outcome };
}

describe("atomic permission grant transactions", () => {
  test("ordinary and risk grants publish together in one durable transaction", async () => {
    let release: () => void = () => {};
    const saved: PermissionRule[][] = [];
    const f = fixture(async (rules, signal) => {
      saved.push([...rules]);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      signal.throwIfAborted();
    });
    const response = f.waiters.respond(f.id, "allow_always");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toHaveLength(2);
    expect(saved[0]?.map((rule) => rule.risk)).toEqual([undefined, "git-push-force"]);
    expect(f.engine.check(operation).policy).toBe("ask");
    expect(f.events.some((event) => event.type === "approval.resolved")).toBe(false);
    release();
    await response;
    expect((await f.outcome).choice).toBe("allow_always");
    expect(f.engine.check(operation).policy).toBe("allow");
  });

  test("a failed whole-grant transaction installs no ordinary or risk rule", async () => {
    let attempts = 0;
    const f = fixture(async (rules) => {
      attempts++;
      expect(rules).toHaveLength(2);
      throw new Error("disk full");
    });
    await expect(f.waiters.respond(f.id, "allow_always")).rejects.toThrow("disk full");
    expect(await f.outcome).toEqual({ choice: "deny", by: "persistence" });
    expect(attempts).toBe(1);
    expect(f.engine.check(operation).policy).toBe("ask");
    expect(f.engine.check({ ...operation, risks: [] }).policy).toBe("ask");
  });

  test("cancellation during I/O aborts publication and never returns a stale allow receipt", async () => {
    let release: () => void = () => {};
    let publication = false;
    const f = fixture(async (_rules, signal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      signal.throwIfAborted();
      publication = true;
    });
    const response = f.waiters.respond(f.id, "allow_always");
    f.controller.abort();
    expect(await f.outcome).toEqual({ choice: "deny", by: "aborted" });
    release();
    expect(await response).toBeUndefined();
    expect(publication).toBe(false);
    expect(f.engine.check(operation).policy).toBe("ask");
    expect(f.waiters.resolutions()).toEqual([{ id: f.id, choice: "deny", by: "aborted" }]);
  });

  test("a changed policy invalidates a saving grant even when it still asks", async () => {
    let release: () => void = () => {};
    const f = fixture(async (_rules, signal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      signal.throwIfAborted();
    });
    const response = f.waiters.respond(f.id, "allow_always");
    f.engine.replaceRules({ rules: [{ action: "shell", policy: "ask", note: "New policy" }] });
    release();
    await expect(response).rejects.toThrow("Permission policy changed");
    expect((await f.outcome).choice).toBe("deny");
    expect(f.engine.check(operation).policy).toBe("ask");
  });

  test("child revocation cancels the shared parent transaction before either authority grants", async () => {
    let release: () => void = () => {};
    let writes = 0;
    const parent = new PermissionEngine({
      rules: [{ action: "shell", policy: "ask" }],
      onRemember: async (rules, signal) => {
        expect(rules).toHaveLength(2);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        signal.throwIfAborted();
        writes++;
      },
    });
    const f = fixture(undefined, parent);
    const response = f.waiters.respond(f.id, "allow_always");
    f.engine.replaceRules({ rules: [{ action: "shell", policy: "deny" }] });
    release();
    await expect(response).rejects.toThrow("Permission policy changed");
    expect((await f.outcome).choice).toBe("deny");
    expect(writes).toBe(0);
    expect(parent.check(operation).policy).toBe("ask");
    expect(f.engine.check(operation).policy).toBe("deny");
  });

  test("an approval gate cannot install a session grant for another chat", async () => {
    const engine = new PermissionEngine();
    const id = engine.decide(operation).approvalId;
    if (!id) throw new Error("Expected approval");
    const waiters = new ApprovalWaiters({
      permissions: () => engine,
      emit: () => {},
      timeoutMs: () => 1000,
    });
    const outcome = await waiters
      .gate("chat-b")
      .wait({ id, request: operation, reason: "test" }, new AbortController().signal);
    expect(outcome).toEqual({ choice: "deny", by: "policy" });
    expect(await waiters.respond(id, "allow_session")).toBeUndefined();
    expect(engine.pending()).toEqual([]);
    expect(engine.check(operation).policy).toBe("ask");
  });
});
