import {
  type HookSample,
  type HookTestResult,
  HookTestResultSchema,
} from "../../../../shared/hooks";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import type { HookCommandSettings } from "../types";
import { type HookEvent, hookIssue, normalizedMatcher } from "./hooks";

export class HookTester {
  busy = $state(false);
  result = $state<HookTestResult | null>(null);
  error = $state("");
  testedDefinition = $state("");
  sample = $state<Required<HookSample>>({
    toolName: "read",
    path: "src/app.ts",
    command: "bun test",
    prompt: "Hook test",
    toolOk: true,
    permissionAction: "read",
  });

  prepare(hook: HookCommandSettings): void {
    const matcher = normalizedMatcher(hook.matcher);
    this.sample.toolName = matcher.tool && matcher.tool !== "*" ? matcher.tool : "read";
    this.sample.path = matcher.path ?? matcher.pathPrefix ?? "src/app.ts";
    this.sample.command = matcher.command ?? matcher.commandPrefix ?? "bun test";
  }
  async run(event: HookEvent, hook: HookCommandSettings): Promise<void> {
    this.error = hookIssue(hook);
    if (this.error) return;
    this.busy = true;
    this.result = null;
    const definition = JSON.stringify(hook);
    try {
      const sample: HookSample = { ...this.sample };
      const response = await requestAgent(
        { type: "hooks.test", event, hook: JSON.parse(definition), sample },
        hook.timeoutMs + 5000,
      );
      if (!response.ok || !response.hookTest)
        throw new Error(response.error ?? t("Could not test the hook"));
      const parsed = HookTestResultSchema.safeParse(response.hookTest);
      if (!parsed.success) throw new Error(t("Could not test the hook"));
      this.result = parsed.data;
      this.testedDefinition = definition;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }
}
