import { describe, expect, test } from "bun:test";
import { permissionRules, sameRule } from "../../src/app/service-policy";
import { defaultConfig } from "../../src/config/defaults";
import { PermissionsConfigSchema } from "../../src/config/schema-sections";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import { permissionRequestKey } from "../../src/security/permission-request-key";
import { PermissionEngine } from "../../src/security/permissions";
import type { PermissionRequest, PermissionRule } from "../../src/security/types";

const operation: PermissionRequest = {
  action: "shell",
  tool: "bash",
  cwd: "/workspace",
  sessionId: "chat-a",
  args: { command: "echo hello" },
  target: "echo hello",
  safety: "unbounded",
};
const exact: PermissionRule = {
  action: "shell",
  tool: "bash",
  policy: "allow",
  requestKey: permissionRequestKey(operation),
};
function ask(engine: PermissionEngine, request = operation): string {
  const decision = engine.decide(request);
  if (!decision.approvalId) throw new Error(`Expected approval, got ${decision.policy}`);
  return decision.approvalId;
}

describe("mandatory human checkpoints", () => {
  test("a checkpoint defeats an exact project grant and cannot be remembered", () => {
    const saved: unknown[] = [];
    const engine = new PermissionEngine({
      rules: [exact, { action: "shell", policy: "ask", checkpoint: true }],
      onRemember: (rules) => {
        saved.push(rules);
      },
    });
    const decision = engine.decide(operation);
    expect(decision.policy).toBe("ask");
    expect(decision.humanOnly).toBe(true);
    expect(decision.review).toBeUndefined();
    expect(engine.pending()[0]?.humanOnly).toBe(true);
    if (!decision.approvalId) throw new Error("Expected checkpoint approval");
    expect(engine.approve(decision.approvalId, "allow_always")?.choice).toBe("allow_once");
    expect(saved).toEqual([]);
    expect(engine.approve(ask(engine), "allow_session")?.choice).toBe("allow_once");
    expect(engine.check(operation).policy).toBe("ask");
  });

  test("a checkpoint on any resource wins even when the others have exact grants", () => {
    const request: PermissionRequest = {
      ...operation,
      action: "write",
      tool: "move",
      paths: ["public/a", "private/b"],
      safety: "bounded",
    };
    const engine = new PermissionEngine({
      rules: [
        {
          action: "write",
          tool: "move",
          policy: "allow",
          requestKey: permissionRequestKey(request),
        },
        { action: "write", pathPrefix: "private", policy: "ask", checkpoint: true },
      ],
    });
    expect(engine.check(request)).toMatchObject({ policy: "ask", humanOnly: true });
  });

  test("a risk checkpoint defeats an exact risk grant while ordinary destructive grants remain valid", () => {
    const request: PermissionRequest = {
      ...operation,
      risks: [{ id: "destroy", label: "Destroy", detail: "No undo" }],
    };
    const allow: PermissionRule = { ...exact, requestKey: permissionRequestKey(request) };
    const rules: PermissionRule[] = [allow, { ...allow, risk: "destroy" }];
    expect(new PermissionEngine({ rules }).check(request).policy).toBe("allow");
    const engine = new PermissionEngine({
      rules: [...rules, { action: "shell", risk: "destroy", policy: "ask", checkpoint: true }],
    });
    expect(engine.check(request)).toMatchObject({ policy: "ask", humanOnly: true });
    expect(engine.approve(ask(engine, request), "allow_always")?.choice).toBe("allow_once");
    expect(engine.check(request).policy).toBe("ask");
  });

  test("parent checkpoints defeat inherited session grants and preserve reason provenance", () => {
    const parent = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    const child = new PermissionEngine({ rules: [{ action: "shell", policy: "allow" }] }, parent);
    child.approve(ask(child), "allow_session");
    expect(child.check(operation).policy).toBe("allow");
    parent.replaceRules({ rules: [{ action: "shell", policy: "ask", checkpoint: true }] });
    expect(child.check(operation)).toMatchObject({ policy: "ask", humanOnly: true });
    expect(child.check(operation).reason).toStartWith("Parent permission: ");
  });

  test("a checkpoint added after a pending request still downgrades remembered choices", () => {
    const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    const id = ask(engine);
    engine.replaceRules({ rules: [{ action: "shell", policy: "ask", checkpoint: true }] });
    expect(engine.approve(id, "allow_session")?.choice).toBe("allow_once");
    expect(engine.check(operation).policy).toBe("ask");
  });

  test("the pending view advertises the checkpoint even when a caller omits its prompt flag", async () => {
    const engine = new PermissionEngine({
      rules: [{ action: "shell", policy: "ask", checkpoint: true }],
    });
    const waiters = new ApprovalWaiters({
      permissions: () => engine,
      emit: () => {},
      timeoutMs: () => 1000,
    });
    const id = ask(engine);
    const outcome = waiters
      .gate("chat-a")
      .wait({ id, request: operation, reason: "test" }, new AbortController().signal);
    expect(waiters.pending()[0]?.humanOnly).toBe(true);
    expect((await waiters.respond(id, "allow_always"))?.choice).toBe("allow_once");
    expect((await outcome).choice).toBe("allow_once");
  });

  test("config and service preserve checkpoint identity", () => {
    const config = defaultConfig();
    config.permissions = PermissionsConfigSchema.parse({
      rules: [{ action: "shell", policy: "ask", checkpoint: true }],
    });
    expect(permissionRules(config).at(-1)?.checkpoint).toBe(true);
    expect(
      sameRule(
        { action: "shell", policy: "ask" },
        { action: "shell", policy: "ask", checkpoint: true },
      ),
    ).toBe(false);
  });
});

describe("automatic review eligibility", () => {
  test("only an unbounded auto action is review eligible", () => {
    const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "auto" }] });
    expect(engine.check(operation)).toMatchObject({ policy: "ask", review: true });
    expect(engine.decide(operation)).toMatchObject({ policy: "ask", review: true });
    expect(engine.check({ ...operation, safety: "bounded" }).policy).toBe("auto");
    expect(new PermissionEngine().check(operation).review).toBeUndefined();
    expect(
      new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] }).check(operation).review,
    ).toBeUndefined();
  });

  test("one explicit ask among resources prevents review of the entire operation", () => {
    const engine = new PermissionEngine({
      rules: [
        { action: "shell", policy: "auto" },
        { action: "shell", pathPrefix: "manual", policy: "ask" },
      ],
    });
    expect(
      engine.check({ ...operation, paths: ["automatic/a", "manual/b"] }).review,
    ).toBeUndefined();
  });

  test("an asked destructive risk cannot be reviewed automatically", () => {
    const engine = new PermissionEngine({ rules: [{ action: "shell", policy: "auto" }] });
    expect(
      engine.check({
        ...operation,
        risks: [{ id: "destroy", label: "Destroy", detail: "No undo" }],
      }).review,
    ).toBeUndefined();
  });

  test("parent and child must both allow automatic review of every ask", () => {
    const auto = new PermissionEngine({ rules: [{ action: "shell", policy: "auto" }] });
    const manual = new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] });
    expect(
      new PermissionEngine({ rules: [{ action: "shell", policy: "auto" }] }, auto).check(operation)
        .review,
    ).toBe(true);
    expect(
      new PermissionEngine({ rules: [{ action: "shell", policy: "auto" }] }, manual).check(
        operation,
      ).review,
    ).toBeUndefined();
    expect(
      new PermissionEngine({ rules: [{ action: "shell", policy: "ask" }] }, auto).check(operation)
        .review,
    ).toBeUndefined();
  });
});
