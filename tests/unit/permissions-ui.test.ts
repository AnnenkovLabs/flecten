import { describe, expect, test } from "bun:test";
import {
  ACTION_META,
  type ApprovalView,
  actionLabel,
  applyPreset,
  approvalAgeLabel,
  buildPolicy,
  isApprovalExpired,
  isCustom,
  POLICY_ACTIONS,
  PRESETS,
  presetDescription,
  reviewedApprovalIds,
  sortApprovals,
  validatePolicy,
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
  test("fills every action", () => {
    const policy = buildPolicy({ read: "allow", shell: "deny" });
    expect(Object.keys(policy).sort()).toEqual([...POLICY_ACTIONS].sort());
    expect(policy.read).toBe("allow");
    expect(policy.shell).toBe("deny");
    expect(policy.write).toBe("ask");
    expect(policy.external_path).toBe("ask");
  });

  test("uses the requested fallback for missing actions", () => {
    const policy = buildPolicy({ read: "deny" }, "auto");
    expect(policy.read).toBe("deny");
    expect(policy.write).toBe("auto");
    expect(policy.network).toBe("auto");
  });

  test("every preset applies a complete policy map", () => {
    for (const preset of PRESETS) {
      const policy = applyPreset(preset.id);
      for (const action of POLICY_ACTIONS) {
        expect(policy[action]).toBe(preset.policies[action]);
      }
      expect(validatePolicy(policy)).toEqual([]);
      expect(isCustom(policy)).toBe(false);
      expect(presetDescription(preset.id)).toBe(preset.description);
    }
  });

  test("applying a preset returns a copy", () => {
    const policy = applyPreset("read_only");
    policy.write = "allow";
    expect(PRESETS.find((preset) => preset.id === "read_only")?.policies.write).toBe("deny");
    expect(isCustom(policy)).toBe(true);
  });

  test("custom keeps the current rules", () => {
    const current = buildPolicy({ read: "deny" }, "auto");
    const kept = applyPreset("custom", current);
    expect(kept).toEqual(current);
    expect(kept).not.toBe(current);
    expect(presetDescription("custom")).toContain("наборам");
  });

  test("detects a single changed rule", () => {
    const workspace = applyPreset("workspace");
    expect(isCustom(workspace)).toBe(false);
    expect(isCustom({ ...workspace, network: "allow" })).toBe(true);
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

  test("explains the risk of shell, network and external paths", () => {
    for (const action of ["shell", "network", "external_path"] as const) {
      expect(ACTION_META[action].risk?.length).toBeGreaterThan(0);
    }
    expect(ACTION_META.read.risk).toBeUndefined();
  });

  test("maps known actions to Russian labels", () => {
    expect(actionLabel("shell")).toBe(ACTION_META.shell.label);
    expect(actionLabel("custom_tool")).toBe("custom_tool");
  });
});

describe("policy validation", () => {
  test("accepts a partial map and fills it separately", () => {
    expect(validatePolicy({ read: "auto", shell: "ask" })).toEqual([]);
    expect(validatePolicy({})).toEqual([]);
  });

  test("names unknown actions and invalid policies", () => {
    const errors = validatePolicy({ read: "sometimes", robot: "allow" });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("read");
    expect(errors.join(" ")).toContain("sometimes");
    expect(errors.join(" ")).toContain("robot");
  });

  test("rejects values that are not objects", () => {
    expect(validatePolicy(null)).toHaveLength(1);
    expect(validatePolicy([])).toHaveLength(1);
    expect(validatePolicy("read")).toHaveLength(1);
  });
});

describe("approval queue helpers", () => {
  test("labels age in compact Russian units", () => {
    expect(approvalAgeLabel(NOW - 1_000, NOW)).toBe("только что");
    expect(approvalAgeLabel(NOW - 12_000, NOW)).toBe("12 с");
    expect(approvalAgeLabel(NOW - 125_000, NOW)).toBe("2 мин");
    expect(approvalAgeLabel(NOW - 7_200_000, NOW)).toBe("2 ч");
    expect(approvalAgeLabel(NOW - 172_800_000, NOW)).toBe("2 д");
  });

  test("clamps future timestamps", () => {
    expect(approvalAgeLabel(NOW + 5_000, NOW)).toBe("только что");
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
