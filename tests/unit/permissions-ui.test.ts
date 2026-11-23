import { describe, expect, test } from "bun:test";
import {
  ACTION_META,
  type ApprovalView,
  accessModeDescription,
  accessModeLabel,
  actionLabel,
  approvalScopePaths,
  approvalSessionLabel,
  buildPolicy,
  isApprovalExpired,
  POLICY_ACTIONS,
  policyOptionsFor,
  reviewedApprovalIds,
  sortApprovals,
} from "../../ui/src/lib/permissions";

const NOW = 1_700_000_000_000;

function approval(id: string, requestedAt: number): ApprovalView {
  return {
    id,
    tool: "bash",
    action: "shell",
    target: `/tmp/${id}`,
    reason: "нужно подтверждение",
    requestedAt,
  };
}

describe("policy maps", () => {
  test("fills every action including destructive", () => {
    const policy = buildPolicy({ read: "allow", shell: "deny", destructive: "ask" });
    expect(Object.keys(policy).sort()).toEqual([...POLICY_ACTIONS].sort());
    expect(policy.read).toBe("allow");
    expect(policy.shell).toBe("deny");
    expect(policy.write).toBe("ask");
    expect(policy.external_path).toBe("ask");
    expect(policy.destructive).toBe("ask");
  });

  test("uses the requested fallback for missing actions", () => {
    const policy = buildPolicy({ read: "deny" }, "auto");
    expect(policy.read).toBe("deny");
    expect(policy.write).toBe("auto");
    expect(policy.network).toBe("auto");
  });

  test("offers Deny, Ask, Allow normally and exposes legacy Auto only when active", () => {
    expect(policyOptionsFor("ask").map((option) => option.value)).toEqual(["deny", "ask", "allow"]);
    expect(policyOptionsFor("allow").map((option) => option.value)).toEqual([
      "deny",
      "ask",
      "allow",
    ]);
    expect(policyOptionsFor("auto").map((option) => option.value)).toEqual([
      "deny",
      "auto",
      "ask",
      "allow",
    ]);
  });
});

describe("access presentation", () => {
  test("describes the three modes and keeps custom settings visible", () => {
    for (const mode of ["agent", "confirm", "full", "custom"] as const) {
      expect(accessModeLabel(mode).length).toBeGreaterThan(0);
      expect(accessModeDescription(mode).length).toBeGreaterThan(0);
    }
    expect(
      new Set(
        ["agent", "confirm", "full"].map((mode) =>
          accessModeLabel(mode as "agent" | "confirm" | "full"),
        ),
      ).size,
    ).toBe(3);
  });

  test("folder consent shows the granted directory, keeping affected files in details", () => {
    expect(approvalScopePaths({ target: "/work", paths: ["/work", "/work/file.txt"] })).toEqual([
      "/work",
    ]);
    expect(approvalScopePaths({ target: "/work/one", paths: [] })).toEqual(["/work/one"]);
    expect(approvalScopePaths({ target: "" })).toEqual([]);
  });

  test("folder grants and repeated exact actions have distinct labels", () => {
    expect(approvalSessionLabel("external_path")).not.toBe(approvalSessionLabel("shell"));
    expect(approvalSessionLabel("shell")).toBe(approvalSessionLabel("mcp"));
  });
});

describe("action metadata", () => {
  test("describes every action", () => {
    for (const action of POLICY_ACTIONS) {
      const meta = ACTION_META[action];
      expect(meta.action).toBe(action);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });

  test("maps known actions to localized labels", () => {
    expect(actionLabel("shell")).toBe(ACTION_META.shell.label);
    expect(actionLabel("destructive")).toBe(ACTION_META.destructive.label);
    expect(actionLabel("custom_tool")).toBe("custom_tool");
  });
});

describe("approval queue helpers", () => {
  test("clamps future timestamps", () => {
    expect(isApprovalExpired(NOW + 5_000, NOW)).toBe(false);
  });

  test("uses the authoritative deadline, including equality", () => {
    expect(isApprovalExpired(NOW + 1, NOW)).toBe(false);
    expect(isApprovalExpired(NOW, NOW)).toBe(true);
    expect(isApprovalExpired(undefined, NOW)).toBe(false);
  });

  test("bulk consent excludes new requests, expired requests and already resolved requests", () => {
    const reviewed = [approval("a", NOW), approval("b", NOW), approval("gone", NOW)];
    const current = [
      { ...approval("a", NOW), expiresAt: NOW + 1 },
      { ...approval("b", NOW), expiresAt: NOW },
      approval("new", NOW),
    ];
    expect(reviewedApprovalIds(reviewed, current, NOW)).toEqual(["a"]);
  });

  test("sorts oldest first without mutating the source", () => {
    const items = [
      approval("b", NOW - 1_000),
      approval("a", NOW - 3_000),
      approval("c", NOW - 3_000),
    ];
    expect(sortApprovals(items).map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(items.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});
