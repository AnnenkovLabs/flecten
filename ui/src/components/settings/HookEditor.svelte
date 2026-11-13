<script lang="ts">
  import { HOOK_NAMES } from "../../../../shared/hooks";
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { hookCanBlock, hookEventLabel, hookEventDescription, hookFieldIssue, hookLimit } from "../../lib/settings/hooks";
  import type { HookEvent } from "../../lib/settings/hooks";
  import type { HookCommandSettings } from "../../lib/types";
  import { linesToArray } from "../../lib/settings-utils";
  import ProviderHeaders from "../ProviderHeaders.svelte";
  import HookConditions from "./HookConditions.svelte";
  import HookTest from "./HookTest.svelte";
  import Icon from "../Icon.svelte";

  let { hook, event, index, onchangeevent }: { hook: HookCommandSettings; event: HookEvent; index: number; onchangeevent: (target: HookEvent) => void } = $props();
  const uid = $props.id();
  const validation = $derived(hookFieldIssue(hook));
  const issue = $derived(validation?.message ?? "");
  const blocking = $derived(hookCanBlock(event));
</script>

<div class="hook-editor">
  <fieldset disabled={settings.saving}>
    <div class="st-grid">
      <label class="st-field"><span class="st-label">{t("Name")}</span><input class="st-input" bind:value={hook.name} maxlength="120" placeholder={t("A name you will recognize")} /></label>
      <div class="st-field"><label class="st-label" for={`${uid}-event`}>{t("When")}</label><select id={`${uid}-event`} data-hook-event class="st-select" value={event} onchange={(e) => onchangeevent(e.currentTarget.value as HookEvent)}>{#each HOOK_NAMES as name (name)}<option value={name} disabled={name !== event && (settings.settings?.hooks?.[name].length ?? 0) >= hookLimit()}>{hookEventLabel(name)}</option>{/each}</select></div>
      <div class="st-field span-2"><label class="st-label" for={`${uid}-action`}>{t("Action")}</label><select id={`${uid}-action`} class="st-select" value={hook.type ?? "command"} onchange={(e) => { hook.type = e.currentTarget.value === "http" ? "http" : "command"; }}><option value="command">{t("Run a command")}</option><option value="http">{t("Send an HTTP request")}</option></select></div>
      {#if hook.type === "http"}
        <label class="st-field span-2"><span class="st-label">{t("HTTP URL")}</span><input class="st-input" type="url" bind:value={hook.url} placeholder="https://example.com/hooks/agent" spellcheck="false" aria-describedby={validation?.field === "url" ? `${uid}-issue` : undefined} aria-invalid={validation?.field === "url" ? "true" : undefined} /></label>
        <p class="st-hint span-2">{t("Sends a POST request containing the event data. Your endpoint can return a decision and additional context.")}</p>
      {:else}
        <label class="st-field span-2"><span class="st-label">{t("Command")}</span><textarea class="st-textarea" rows="2" bind:value={hook.command} placeholder="bun run scripts/check-tool.ts" spellcheck="false" data-settings-field={t("Hook command")} aria-describedby={validation?.field === "command" ? `${uid}-issue` : undefined} aria-invalid={validation?.field === "command" ? "true" : undefined}></textarea></label>
        <p class="st-hint span-2">{t("Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.")}</p>
      {/if}
      <p class="st-hint span-2">{hookEventDescription(event)}</p>
    </div>
    {#if issue && validation?.field !== "timeout"}<p id={`${uid}-issue`} class="st-error" role="alert">{issue}</p>{/if}
    <HookConditions {hook} {event} />
    <div class="st-field"><label class="st-label" for={`${uid}-response`}>{t("Response format")}</label><select id={`${uid}-response`} aria-describedby={`${uid}-response-hint`} class="st-select" value={hook.responseFormat ?? "json"} onchange={(e) => hook.responseFormat = e.currentTarget.value === "text" ? "text" : "json"}><option value="text">{t("Text output")}</option><option value="json">{t("JSON decision and context")}</option></select><span id={`${uid}-response-hint`} class="st-hint">{hook.responseFormat === "text" ? t("Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.") : t("Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.")}</span></div>
    <details class="st-details">
      <summary>{t("Execution")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
      <div class="st-details-body">
        {#if hook.type === "http"}<ProviderHeaders provider={hook} providerId={hook.id ?? uid} />{:else}<label class="st-field"><span class="st-label">{t("Inherited environment variables")}</span><textarea class="st-textarea" rows="2" value={hook.envAllowlist?.join("\n") ?? ""} placeholder="NODE_ENV\nCI" oninput={(e) => hook.envAllowlist = linesToArray(e.currentTarget.value)}></textarea><span class="st-hint">{t("One variable name per line. Only these extra variables are passed from the app environment.")}</span></label>{/if}
        <label class="st-field"><span class="st-label">{t("Timeout, seconds")}</span><input class="st-input timeout-input" aria-invalid={validation?.field === "timeout" ? "true" : undefined} aria-describedby={validation?.field === "timeout" ? `${uid}-timeout-issue` : undefined} type="number" min="0.1" max="60" step="0.1" value={hook.timeoutMs / 1000} oninput={(e) => hook.timeoutMs = Number(e.currentTarget.value) * 1000} />{#if validation?.field === "timeout"}<span class="st-error" id={`${uid}-timeout-issue`} role="alert">{issue}</span>{/if}</label>
        {#if blocking}
          <label class="st-switch"><span class="st-switch-copy"><strong>{t("Block on failure")}</strong><span>{t("Stop the action if the hook crashes, times out, or returns an invalid response.")}</span></span><input type="checkbox" bind:checked={hook.failClosed} /><span class="st-switch-track" aria-hidden="true"></span></label>
        {:else}
          <label class="st-switch"><span class="st-switch-copy"><strong>{t("Run in background")}</strong><span>{t("Continue without waiting. This hook cannot block an action or add context to the current step.")}</span></span><input type="checkbox" bind:checked={hook.async} /><span class="st-switch-track" aria-hidden="true"></span></label>
        {/if}
        <p class="st-hint">{blocking ? t("A deny decision always stops this action. This setting controls unexpected failures only.") : t("This event observes an action that already happened. A deny decision has no effect.")}</p>
      </div>
    </details>
  </fieldset>
  <HookTest {hook} {event} {index} />
</div>

<style>
  .hook-editor, fieldset { display: grid; min-width: 0; gap: 16px; }
  fieldset { margin: 0; padding: 0; border: 0; }
  .timeout-input { max-width: 140px; }
  @media (max-width: 650px) { .st-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
