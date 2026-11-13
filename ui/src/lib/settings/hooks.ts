import { HOOK_EVENTS, HOOK_NAMES, MAX_HOOKS_PER_EVENT } from "../../../../shared/hooks";
import { t } from "../i18n.svelte";
import type { HookCommandSettings, HooksSettings } from "../types";

export type HookEvent = keyof HooksSettings;
export type HookMatcher = Exclude<HookCommandSettings["matcher"], string>;
export type HookMatcherField = keyof HookMatcher;

export function hookEventLabel(event: HookEvent): string {
  return t(HOOK_EVENTS[event].label);
}
export function hookEventDescription(event: HookEvent): string {
  return t(HOOK_EVENTS[event].description);
}
export function hookCanBlock(event: HookEvent): boolean {
  return HOOK_EVENTS[event].blocking;
}
export function hookLimit(): number {
  return MAX_HOOKS_PER_EVENT;
}
export function emptyHooks(): HooksSettings {
  return Object.fromEntries(HOOK_NAMES.map((event) => [event, []])) as unknown as HooksSettings;
}
export function newHook(): HookCommandSettings {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "command",
    responseFormat: "text",
    command: "",
    matcher: {},
    timeoutMs: 10_000,
    enabled: true,
    failClosed: false,
    async: false,
  };
}
export function copyHook(hook: HookCommandSettings): HookCommandSettings {
  return {
    ...JSON.parse(JSON.stringify(hook)),
    id: crypto.randomUUID(),
    name: t("{0} copy", [hook.name || t("Hook")]),
  };
}
export function normalizedMatcher(matcher: HookCommandSettings["matcher"]): HookMatcher {
  if (typeof matcher !== "string") return { ...matcher };
  return matcher && matcher !== "*" ? { tool: matcher } : {};
}
export function setHookMatcher(
  hook: HookCommandSettings,
  field: HookMatcherField,
  value: string,
): void {
  const next = normalizedMatcher(hook.matcher);
  if (value) next[field] = value;
  else delete next[field];
  hook.matcher = next;
}
export function hookTitle(hook: HookCommandSettings): string {
  return (
    hook.name?.trim() ||
    (hook.type === "http" ? hook.url : hook.command)?.trim() ||
    t("Untitled hook")
  );
}
export function hookSummary(hook: HookCommandSettings): string {
  const matcher = normalizedMatcher(hook.matcher);
  const parts = Object.values(matcher).filter(Boolean);
  return parts.length ? parts.join(" · ") : t("Every occurrence");
}
export function hookFieldIssue(
  hook: HookCommandSettings,
): { field: "command" | "url" | "timeout"; message: string } | undefined {
  if (hook.type === "http") {
    try {
      if (!["http:", "https:"].includes(new URL(hook.url ?? "").protocol))
        return { field: "url", message: t("Only http and https are supported.") };
    } catch {
      return { field: "url", message: t("Enter the full hook URL.") };
    }
  } else if (!hook.command.trim())
    return { field: "command", message: t("Enter the hook command.") };
  if (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs < 100 || hook.timeoutMs > 60_000)
    return { field: "timeout", message: t("Hook timeout must be between 0.1 and 60 seconds.") };
  return undefined;
}
export function hookIssue(hook: HookCommandSettings): string {
  return hookFieldIssue(hook)?.message ?? "";
}
export function moveHook(
  hooks: HookCommandSettings[],
  index: number,
  offset: number,
): HookCommandSettings[] {
  const target = index + offset;
  if (target < 0 || target >= hooks.length) return hooks;
  const next = [...hooks];
  const [hook] = next.splice(index, 1);
  if (hook) next.splice(target, 0, hook);
  return next;
}
