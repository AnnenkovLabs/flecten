<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { partialArgsPreview, toolIcon } from "../lib/agent";
  import type { PendingToolCall } from "../lib/types";
  import { toolName } from "../lib/tool-presentation";
  import { streamingField } from "../lib/partial-json";
  import Icon from "./Icon.svelte";

  let { calls }: { calls: PendingToolCall[] } = $props();
</script>

<div class="calls" aria-label={t("Preparing tool call")}>
  <span class="caption">{t("Preparing tool call")}</span>
  {#each calls as call, index (call.index)}
    <div class="call">
      <Icon name={toolIcon(call.name)} size={13} />
      <span class="name" title={toolName(call.name, { agent: streamingField(call.args, ["agent"]), operation: streamingField(call.args, ["operation", "op"]) })}>{toolName(call.name, { agent: streamingField(call.args, ["agent"]), operation: streamingField(call.args, ["operation", "op"]) })}</span>
      {#if call.args}
        <span class="args" title={partialArgsPreview(call.args)}>{partialArgsPreview(call.args)}</span>
      {/if}
      {#if index === calls.length - 1}
        <span class="caret" aria-hidden="true"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .calls {
    display: grid;
    gap: 2px;
    margin: 9px 0 0 7px;
    padding-left: 15px;
    border-left: 1px solid var(--line-strong);
  }

  .call {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    color: var(--muted);
    font-size: 12.5px;
    animation: call-in 420ms var(--ease-jelly) both;
  }

  .call :global(.icon) {
    color: var(--muted);
  }

  .name {
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-2);
    white-space: nowrap;
  }

  .caption { color: var(--muted); font-size: 12px; }

  @media (prefers-reduced-motion: reduce) {
    .call, .caret { animation: none; }
  }

  .args {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    width: 2px;
    height: 13px;
    flex: none;
    border-radius: 2px;
    background: var(--primary);
    animation:
      caret 1s steps(2, start) infinite,
      caret-morph 2.4s var(--ease-jelly) infinite;
  }

  @keyframes call-in {
    0% {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
    64% {
      opacity: 1;
      transform: translateY(-1px) scale(1.005);
    }
    100% {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes caret-morph {
    0%,
    100% {
      border-radius: 2px;
      transform: scaleY(1);
    }
    50% {
      border-radius: 999px;
      transform: scaleY(1.2);
    }
  }

  @keyframes caret {
    50% {
      opacity: 0;
    }
  }
</style>
