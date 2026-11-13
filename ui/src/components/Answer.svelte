<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Snippet } from "svelte";
  import { relativeTime, timeTitle } from "../lib/ui-polish";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";
  import MirroredMarkdown from "./MirroredMarkdown.svelte";
  import type { RunAction } from "../lib/types";

  interface Props {
    text: string;
    completedSummary?: string | undefined;
    tools?: ReadonlyMap<string, RunAction>;
    streaming?: boolean;
    at?: string | undefined;
    now?: number;
    prompt?: string | undefined;
    onRepeat?: (prompt?: string) => void;
    children?: Snippet;
  }

  let {
    text,
    completedSummary,
    tools = new Map(),
    streaming = false,
    at,
    now = Date.now(),
    prompt,
    onRepeat,
    children,
  }: Props = $props();

  const relative = $derived(at ? relativeTime(at, new Date(now)) : "");
  const title = $derived(at ? timeTitle(at, new Date(now)) : "");

</script>

<div class="answer" class:is-streaming={streaming}>
  <MirroredMarkdown {text} {tools} />
  {@render children?.()}
  {#if completedSummary !== undefined}
    <div class="answer-foot">
      <div class="answer-actions">
        <CopyButton text={text || completedSummary} label={t("Copy response")} />
        {#if onRepeat}
          <button
            class="st-icon-btn"
            type="button"
            aria-label={t("Retry")}
            title={t("Retry")}
            onclick={() => onRepeat(prompt)}
          >
            <Icon name="refresh" size={15} />
          </button>
        {/if}
      </div>
      {#if at && relative}
        <time class="answer-time" datetime={at} title={title}>{relative}</time>
      {/if}
    </div>
  {/if}
</div>

<style>
  .answer {
    max-width: 68ch;
    margin-top: 16px;
    color: var(--text-body);
    font-size: 16px;
    line-height: 1.65;
    text-wrap: pretty;
    transition: opacity 280ms var(--ease);
  }

  .answer.is-streaming {
    opacity: 0.96;
  }

  .answer-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
    margin-top: 6px;
  }

  .answer-time {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.3;
  }

  .answer-actions {
    display: flex;
    gap: 8px;
  }

</style>
