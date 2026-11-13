import { describe, expect, it } from "bun:test";
import { SETTINGS_SECTIONS, searchSettingsSections } from "../../ui/src/lib/settings/sections";
import {
  adoptRules,
  closeAction,
  configScope,
  contextIssue,
  permissionPolicies,
  saveBlocker,
  scopeLabel,
  setPermissionPolicy,
  settingsDirty,
  settingsEqual,
} from "../../ui/src/lib/settings-utils";
import type { HarnessSettings } from "../../ui/src/lib/types";

function config(overrides: Partial<HarnessSettings> = {}): HarnessSettings {
  return {
    provider: "openai",
    model: "gpt-5.1",
    providers: {
      openai: {
        protocol: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        headers: {},
        models: { "gpt-5.1": { name: "GPT-5.1" } },
        reasoningReplay: "auto",
        reasoningDetails: "auto",
        thinking: "auto",
        thinkingParam: "auto",
        thinkingKeep: "auto",
        clearThinking: "auto",
        preserveThinking: "auto",
        promptCaching: true,
        streamUsage: true,
        strictTools: false,
      },
    },
    maxOutputTokens: 16_384,
    catalog: { autoRefresh: true, ttlMs: 43_200_000 },
    context: { window: 200_000, reserve: 16_000 },
    loop: { maxTurns: 100, continuations: 2, parallelTools: true },
    tools: {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 120_000,
      readLimitLines: 2000,
    },
    ...overrides,
  };
}

describe("settingsDirty", () => {
  it("treats a deep clone with reordered keys as clean", () => {
    const current = config();
    const snapshot = config({ context: { reserve: 16_000, window: 200_000 } });
    expect(settingsEqual(current, snapshot)).toBe(true);
    expect(settingsDirty(current, snapshot)).toBe(false);
  });

  it("detects nested edits", () => {
    const current = config();
    const snapshot = config();
    current.loop.maxTurns = 25;
    expect(settingsDirty(current, snapshot)).toBe(true);
  });

  it("is dirty until a snapshot exists and clean without settings", () => {
    expect(settingsDirty(config(), null)).toBe(true);
    expect(settingsDirty(null, config())).toBe(false);
  });
});

describe("searchSettingsSections", () => {
  it("searches field keys and section labels", () => {
    expect(searchSettingsSections("maxTurns")).toEqual([]);
    expect(searchSettingsSections("sendShortcut").map((entry) => entry.id)).toEqual(["general"]);
    expect(searchSettingsSections("maxCostUsd")).toEqual([]);
    expect(searchSettingsSections("bashTimeoutMs").map((entry) => entry.id)).toEqual(["tools"]);
    expect(searchSettingsSections("разрешения").map((entry) => entry.id)).toEqual(["permissions"]);
  });

  it("returns every section for an empty query", () => {
    expect(searchSettingsSections("  ").length).toBe(SETTINGS_SECTIONS.length);
  });

  it("returns nothing for an unknown query", () => {
    expect(searchSettingsSections("нет-такого-поля")).toEqual([]);
  });
});

describe("closeAction", () => {
  it("confirms only when there are unsaved changes", () => {
    expect(closeAction(false)).toBe("close");
    expect(closeAction(true)).toBe("confirm");
  });
});

describe("configScope", () => {
  it("labels the project scope and resolves the config path", () => {
    expect(scopeLabel("project")).toBe("Проект");
    expect(scopeLabel("global")).toBe("Глобальные");
    expect(configScope("/repo/")).toEqual({
      kind: "project",
      label: "Проект",
      path: "/repo/flecten.config.json",
    });
    expect(configScope(undefined).path).toBe("");
  });

  it("marks an explicit config path as global", () => {
    expect(configScope("/repo", "/etc/flecten.config.json")).toEqual({
      kind: "global",
      label: "Глобальные",
      path: "/etc/flecten.config.json",
    });
  });
});

describe("saveBlocker", () => {
  it("reports saving and clean states; running tasks do not block a save", () => {
    expect(saveBlocker({ saving: true, dirty: true })).toContain("уже выполняется");
    expect(saveBlocker({ saving: false, dirty: false })).toContain("Нет несохранённых изменений");
    expect(saveBlocker({ saving: false, dirty: true })).toBe("");
  });
});

describe("adoptRules", () => {
  it("takes rules the core saved into the form without touching policies", () => {
    const form = config();
    setPermissionPolicy(form, "shell", "ask");
    const saved = config();
    (saved as unknown as { permissions: { rules: unknown[] } }).permissions = {
      rules: [{ action: "shell", tool: "bash", pattern: "bun test", policy: "allow" }],
    } as never;
    adoptRules(form, saved);
    expect(permissionPolicies(form).shell).toBe("ask");
    expect(
      (form as unknown as { permissions: { rules: unknown[] } }).permissions.rules,
    ).toHaveLength(1);
  });
});

describe("permission policies", () => {
  it("reads defaults and writes the config field used by the core", () => {
    const value = config();
    expect(permissionPolicies(value)).toMatchObject({
      read: "auto",
      network: "ask",
      external_path: "deny",
    });
    setPermissionPolicy(value, "external_path", "allow");
    expect(permissionPolicies(value).external_path).toBe("allow");
    expect(
      (value as HarnessSettings & { permissions?: { externalPath?: string } }).permissions
        ?.externalPath,
    ).toBe("allow");
  });
});

describe("contextIssue", () => {
  it("accepts a sane window and reserve", () => {
    expect(contextIssue(200_000, 16_000, 16_384)).toBe("");
  });

  it("rejects a reserve outside the window", () => {
    expect(contextIssue(200_000, 200_000)).toContain("меньше окна");
    expect(contextIssue(0, 0)).toContain("больше нуля");
  });
});
