import { HOOK_NAMES } from "../../../../shared/hooks";
import { canDescribeImages } from "../../../../shared/vision";
import { t } from "../i18n.svelte";
import { contextIssue } from "../settings-utils";
import type { HarnessSettings, ModelInfo, ProviderSettings } from "../types";
import { hookEventLabel, hookIssue } from "./hooks";

export function numberIssue(
  value: number | undefined,
  min = 1,
  max = Infinity,
  integer = true,
): string {
  if (value === undefined) return "";
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    return integer ? t("Enter a whole number.") : t("Enter a number.");
  }
  if (value < min || value > max) {
    if (min === Number.MIN_VALUE && value < min) return t("Must be greater than zero.");
    return Number.isFinite(max)
      ? t("From {0} to {1}.", [min, max])
      : t("Must be at least {0}.", [min]);
  }
  return "";
}

/** Same field constraints as the saved config, including fields inside disclosures. */
export function settingsIssue(config: HarnessSettings): string {
  if (config.vision?.model) {
    const model =
      config.providers[config.vision.provider || config.provider]?.models[config.vision.model];
    if (!model || model.disabled || !canDescribeImages(model))
      return t("Choose a model with image input.");
  }
  const translation = config.translation;
  if (translation?.enabled && config.conversation?.enabled === false) {
    const model = config.providers[translation.provider]?.models[translation.model];
    if (!model || model.tools === false)
      return t("Choose a translation model that supports tools.");
    const timeout = numberIssue(translation.timeoutMs / 1000, 1, 120);
    if (timeout) return t("Translation timeout in seconds: {0}", [timeout]);
    if (translation.language !== "auto") {
      try {
        new Intl.Locale(translation.language);
      } catch {
        return t("Enter a response language: auto, ru, uk, en, or another language code.");
      }
    }
  }
  if (config.voice && (config.voice.engine ?? "api") === "api" && !config.voice.model.trim())
    return t("Specify a speech recognition model.");
  if (
    config.voice?.engine &&
    config.voice.engine !== "api" &&
    config.voice.local &&
    !config.voice.local.python.trim()
  )
    return t("Specify Python for local speech recognition.");
  for (const [id, provider] of Object.entries(config.providers)) {
    const issue = providerIssue(provider);
    if (issue) return `${provider.name || id}: ${issue}`;
  }
  for (const [id, server] of Object.entries(config.mcp?.servers ?? {})) {
    if ("url" in server) {
      try {
        const url = new URL(server.url);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          return t("{0}: MCP only supports http and https.", [id]);
      } catch {
        return t("{0}: enter the full MCP URL.", [id]);
      }
    } else if (!server.command.trim()) return t("{0}: enter an MCP command.", [id]);
    for (const [label, value, min, max] of [
      [t("Timeout"), server.timeoutMs, 1000, 300_000],
      [t("Tools"), server.maxTools, 1, 128],
      [t("Context"), server.contextTokens, 64, 100_000],
    ] as const) {
      const issue = numberIssue(value, min, max);
      if (issue) return `${id}, ${label}: ${issue}`;
    }
  }
  for (const event of HOOK_NAMES) {
    for (const hook of config.hooks?.[event] ?? []) {
      const issue = hookIssue(hook);
      if (issue) return `${hook.name || hookEventLabel(event)}: ${issue}`;
    }
  }
  const context = contextIssue(
    config.context.window,
    config.context.reserve,
    config.maxOutputTokens,
  );
  if (context) return context;
  const fields: Array<[string, number | undefined, number, number, boolean?]> = [
    [t("Concurrent tasks"), config.sessions?.maxConcurrent, 1, 16],
    [t("Terminal lines"), config.terminal?.scrollback, 1, 100_000],
    [t("Command timeout"), config.terminal?.commandTimeoutMs, 1, 600_000],
    [t("Background command wait time"), config.terminal?.jobWaitMs, 1, 1_800_000],
    [t("Background command duration"), config.terminal?.jobTimeoutMs, 1, Infinity],
    [t("Processes"), config.terminal?.maxProcesses, 1, 4096],
    [t("Process memory"), config.terminal?.maxMemoryMb, 1, 1_048_576],
    [t("Snapshot retention"), config.checkpoints?.maxAgeDays, 1, 365],
    [t("Snapshot count"), config.checkpoints?.keep, 1, 10_000],
    [t("Files per snapshot"), config.checkpoints?.maxFiles, 1, 20_000],
    [t("Snapshot size"), config.checkpoints?.maxMegabytes, 1, 4096],
    [t("Output in bytes"), config.tools.maxOutputBytes, 1, Infinity],
    [t("Output in lines"), config.tools.maxOutputLines, 1, Infinity],
    [t("bash timeout"), config.tools.bashTimeoutMs, 1, Infinity],
    [t("Lines to read"), config.tools.readLimitLines, 1, Infinity],
  ];
  for (const [title, value, min, max, integer] of fields) {
    const issue = numberIssue(value, min, max, integer);
    if (issue) return `${title}: ${issue}`;
  }
  return "";
}

export function modelIssues(model: ModelInfo): Record<string, string> {
  const issues: Record<string, string> = {};
  for (const key of ["context", "input", "output", "reasoningBudget"] as const) {
    const issue = numberIssue(model[key]);
    if (issue) issues[key] = issue;
  }
  if (model.context && model.output && model.output > model.context)
    issues.output = t("The response limit must not exceed the context window.");
  if (model.reasoningMode === "budget") {
    if (!model.reasoningBudget) issues.reasoningBudget = t("Specify a reasoning budget.");
    else if (model.output && model.reasoningBudget >= model.output)
      issues.reasoningBudget = t("The reasoning budget must be less than the response limit.");
  }
  return issues;
}

export function providerIssue(provider: ProviderSettings): string {
  try {
    const url = new URL(provider.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return t("Only http and https are supported.");
  } catch {
    return t("Enter the full API URL.");
  }
  const timeout = numberIssue(provider.transportTimeoutMs, 1000, 600_000);
  if (timeout) return t("Request timeout: {0}", [timeout]);
  for (const [id, model] of Object.entries(provider.models)) {
    const issue = Object.values(modelIssues(model))[0];
    if (issue) return `${model.name || id}: ${issue}`;
  }
  return "";
}
