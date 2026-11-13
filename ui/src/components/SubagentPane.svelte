<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { SubagentView } from "../lib/run/subagents.svelte";
  import { subagentRole, subagentStatus } from "../lib/subagent-presentation";
  import type { RunAction } from "../lib/types";
  import Icon from "./Icon.svelte";
  import RunGroup from "./RunGroup.svelte";
  import SubagentAvatar from "./SubagentAvatar.svelte";
  import SubagentDetail from "./SubagentDetail.svelte";
  import ToolCallProgress from "./ToolCallProgress.svelte";
  import Markdown from "./Markdown.svelte";

  let { agent, action, onStop }: { agent: SubagentView; action: RunAction; onStop: () => void } = $props();
  const runs = $derived(agent.thread.items.filter((item) => item.kind === "run"));
</script>

<div class="subagent-pane" id={`pane-subagent:${agent.id}`} role="tabpanel" aria-labelledby={`tab-subagent:${agent.id}`}>
  <div class="subagent-head">
    <SubagentAvatar variant={agent.avatar} size={48} />
    <div class="identity"><h2>{agent.name}</h2><p>{subagentRole(agent.agent)}<span>·</span>{subagentStatus(agent.status)}</p></div>
    {#if agent.status === "running"}
      <button class="stop-child" type="button" disabled={agent.stopping} title={t("Cancel: {0}", [agent.name])} onclick={onStop}>
        <Icon name="stop" size={14} />{agent.stopping ? t("Waiting for the step to finish") : t("Stop tool")}
      </button>
    {/if}
  </div>
  <div class="subagent-scroll">
    <div class="subagent-content">
      <details class="assignment"><summary>{t("Assigned task")}</summary><p>{agent.prompt}</p></details>
      {#each agent.messages as text, index (index)}<Markdown {text} />{/each}
      {#each runs as item (item.id)}<RunGroup id={item.id} summary={item.summary} onOpenChanges={() => {}} />{/each}
      {#if agent.thread.pendingCalls.length}<ToolCallProgress calls={agent.thread.pendingCalls} />{/if}
      {#if agent.result?.error}<p class="child-error" role="alert">{agent.result.error}</p>{/if}
      <SubagentDetail {action} showPrompt={false} />
      {#if agent.result}<details class="assignment"><summary>{t("Technical details")}</summary><pre>{agent.result.summary}</pre></details>{/if}
    </div>
  </div>
</div>

<style>
  .subagent-pane { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  .subagent-head { display: flex; flex: none; align-items: center; gap: 12px; padding: 20px 28px; border-bottom: 1px solid var(--line); }
  .identity { min-width: 0; }
  h2 { font-size: 18px; font-weight: 600; }
  .identity p { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; }
  .stop-child { display: flex; align-items: center; gap: 7px; flex: none; margin-left: auto; padding: 0 10px; min-height: var(--control-h); border-radius: 6px; color: var(--error); background: var(--surface); font-size: 12px; }
  .stop-child:hover { background: var(--raised); }
  .stop-child:disabled { opacity: .55; }
  .subagent-scroll { overflow-y: auto; min-height: 0; flex: 1; }
  .subagent-content { max-width: var(--content-w); margin-inline: auto; padding: 20px 28px 40px; display: grid; gap: 24px; }
  .assignment summary { min-height: var(--control-h); align-content: center; color: var(--text-2); font-size: 13px; cursor: pointer; }
  .assignment p { margin-top: 8px; font-size: 13px; line-height: 1.7; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
  .child-error { font-size: 13px; line-height: 1.6; color: var(--error); overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; color: var(--muted); }
  @media (max-width: 600px) { .subagent-head, .subagent-content { padding-inline: 16px; } }
</style>
