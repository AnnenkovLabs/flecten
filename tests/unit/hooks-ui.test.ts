import { beforeEach, describe, expect, test } from "bun:test";
import { HOOK_NAMES } from "../../shared/hooks";
import { setLocale } from "../../ui/src/lib/i18n.svelte";
import {
  copyHook,
  emptyHooks,
  hookIssue,
  hookSummary,
  hookTitle,
  moveHook,
  newHook,
  setHookMatcher,
} from "../../ui/src/lib/settings/hooks";

describe("hook settings workflow", () => {
  beforeEach(() => setLocale("en"));
  test("adding, copying and moving hooks preserves identity and existing conditions", () => {
    const hooks = emptyHooks();
    expect(Object.keys(hooks)).toEqual(HOOK_NAMES);
    const first = newHook();
    first.name = "Check release";
    first.command = "bun run check";
    first.matcher = "bash";
    setHookMatcher(first, "pathPrefix", "src");
    expect(first).toMatchObject({ matcher: { tool: "bash", pathPrefix: "src" } });
    setHookMatcher(first, "pathPrefix", "");
    expect(first).toMatchObject({ matcher: { tool: "bash" } });
    expect(hookTitle(first)).toBe("Check release");
    expect(hookSummary(first)).toBe("bash");
    const copied = copyHook(first);
    expect(copied.id).not.toBe(first.id);
    setHookMatcher(copied, "tool", "read");
    expect(first).toMatchObject({ matcher: { tool: "bash" } });
    hooks.preToolUse = [first, copied];
    const moved = moveHook(hooks.preToolUse, 1, -1);
    expect(moved).toEqual([copied, first]);
    expect(hooks.preToolUse).toEqual([first, copied]);
    expect(moveHook(moved, 0, -1)).toBe(moved);
  });

  test("command, URL and timeout errors stop settings save before a backend request", () => {
    const hook = newHook();
    expect(hookIssue(hook)).toContain("command");
    hook.command = "bun run check";
    expect(hookIssue(hook)).toBe("");
    hook.type = "http";
    hook.command = "";
    hook.url = "file:///tmp/hook";
    expect(hookIssue(hook)).toContain("http");
    hook.url = "https://example.com/hook";
    expect(hookIssue(hook)).toBe("");
    hook.timeoutMs = 99;
    expect(hookIssue(hook)).toContain("60");
    hook.timeoutMs = Number.NaN;
    expect(hookIssue(hook)).not.toBe("");
  });
});
