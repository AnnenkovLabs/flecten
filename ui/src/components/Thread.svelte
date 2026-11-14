<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onDestroy, onMount, tick, untrack } from "svelte";
  import { restoredThreadTop, saveThreadPosition, threadPosition } from "../lib/thread-position";
  import { ThreadViewport } from "../lib/thread-viewport.svelte";
  import { threadRowKeys } from "../lib/thread-window";
  import type { PendingToolCall, ThreadItem } from "../lib/types";
  import { focusComposer, relativeTime, searchThread, timeTitle } from "../lib/ui-polish";
  import { conversationItems, workerMirrors } from "../lib/run/worker-mirrors";
  import RunActionRow from "./RunActionRow.svelte";
  import Answer from "./Answer.svelte";
  import { copyText } from "../lib/clipboard.svelte";
  import type { SummaryDestination } from "../lib/markdown/summary-navigation";
  import ApprovalCard from "./ApprovalCard.svelte";
  import ErrorCard from "./ErrorCard.svelte";
  import HtmlSummary from "./HtmlSummary.svelte";
  import Icon from "./Icon.svelte";
  import LiveRun from "./LiveRun.svelte";
  import NoticeCard from "./NoticeCard.svelte";
  import RunGroup from "./RunGroup.svelte";
  import ThreadSearch from "./ThreadSearch.svelte";
  import ToolCallProgress from "./ToolCallProgress.svelte";
  import UserMessage from "./UserMessage.svelte";

  interface Props {
    taskId: string;
    items: ThreadItem[];
    live: boolean;
    busy: boolean;
    liveLabel: string;
    pendingCalls: PendingToolCall[];
    onOpenChanges: () => void;
    onRepeat: (prompt?: string) => void;
    onNavigateSummary?: (destination: SummaryDestination) => void;
  }

  let {
    taskId,
    items: entries,
    live,
    busy,
    liveLabel,
    pendingCalls,
    onOpenChanges,
    onRepeat,
    onNavigateSummary,
  }: Props = $props();

  const NEAR_BOTTOM = 72;
  let scroller: HTMLDivElement;
  let threadInner: HTMLDivElement;
  let focusToken = $state(0);
  const toolMirrors = $derived(workerMirrors(entries));
  const items = $derived(conversationItems(entries, toolMirrors));

  let now = $state(Date.now());
  let atBottom = $state(true);
  let unread = $state(0);
  let seenMessages = 0;
  let currentTask = "";
  let restoring = false;
  let lastTop = 0;
  let searchOpen = $state(false);
  let query = $state("");
  let searchIndex = $state(0);
  const viewport = $derived(new ThreadViewport());
  const rowIds = $derived(threadRowKeys(items));
  const window = $derived(viewport.range);
  const visible = $derived(items.slice(window.start, window.end));

  const revision = $derived(
    items
      .map((item) => {
        if (item.kind === "answer") return item.text.length;
        if (item.kind === "worker-tool") return toolMirrors.get(item.reference)?.detail?.output?.length ?? 0;
        if (item.kind === "run") {
          const reasoning = item.summary.turns.reduce(
            (total, turn) => total + turn.reasoning.length,
            0,
          );
          return item.summary.list.length + reasoning;
        }
        return 0;
      })
      .join(","),
  );
  const reasoningLive = $derived(
    items.some(
      (item) =>
        item.kind === "run" &&
        item.summary.turns.some((turn) => turn.reasoningStreaming === true),
    ),
  );
  const messageCount = $derived(
    items.reduce(
      (total, item) => total + (item.kind === "message" || item.kind === "answer" ? 1 : 0),
      0,
    ),
  );
  const hits = $derived(searchThread(items, query, toolMirrors));
  const hitIds = $derived(new Set(hits.map((hit) => hit.id)));
  const activeId = $derived(hits[searchIndex]?.id ?? "");
  const jumpLabel = $derived(
    unread > 0 ? t("Scroll down, new messages: {0}", [unread]) : t("Scroll to latest message"),
  );

  function distanceToEnd(): number {
    if (!scroller) return 0;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }

  function followEnd(): void {
    if (!scroller || scroller.clientHeight === 0) return;
    // A resize can run before the browser delivers the user's queued scroll event.
    if (releaseFollowOnScrollUp()) {
      onScroll();
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
    viewport.scroll();
    lastTop = scroller.scrollTop;
  }

  function releaseFollowOnScrollUp(): boolean {
    if (scroller.scrollTop >= lastTop - 1 || distanceToEnd() <= 1) return false;
    if (atBottom) {
      atBottom = false;
      seenMessages = messageCount;
    }
    return true;
  }

  function onScroll(): void {
    viewport.scroll();
    if (restoring || taskId !== currentTask || scroller.clientHeight === 0) return;
    const movedDown = scroller.scrollTop > lastTop + 1;
    const movedUp = releaseFollowOnScrollUp();
    lastTop = scroller.scrollTop;
    if (!movedUp && viewport.adjusting) return;
    const distance = distanceToEnd();
    if (!movedUp && (distance <= 1 || (movedDown && distance <= NEAR_BOTTOM))) {
      atBottom = true;
      unread = 0;
      seenMessages = messageCount;
    }
    rememberPosition();
  }

  function rememberPosition(): void {
    if (!currentTask) return;
    const anchor = viewport.anchor();
    saveThreadPosition(currentTask, {
      // Children can be removed before onDestroy. Keep the last visible offset, not detached DOM geometry.
      top: lastTop,
      atEnd: atBottom,
      seenMessages,
      ...(!atBottom && anchor ? { anchor } : {}),
    });
  }

  function jumpToBottom(): void {
    atBottom = true;
    unread = 0;
    seenMessages = messageCount;
    rememberPosition();
    if (!scroller) return;
    const reduce = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }

  function openSearch(): void {
    if (searchOpen) focusToken += 1;
    else searchOpen = true;
  }

  function closeSearch(): void {
    if (!searchOpen) return;
    searchOpen = false;
    query = "";
    searchIndex = 0;
    focusComposer();
  }

  $effect.pre(() => {
    const nextTask = taskId;
    const ids = rowIds;
    if (nextTask === currentTask) {
      untrack(() => viewport.setRows(nextTask, ids));
      return;
    }
    untrack(() => {
      rememberPosition();
      viewport.setRows(nextTask, ids);
    });
    currentTask = nextTask;
    const saved = threadPosition(nextTask);
    atBottom = saved?.atEnd ?? true;
    seenMessages = saved?.seenMessages ?? messageCount;
    unread = Math.max(0, messageCount - seenMessages);
    searchOpen = false;
    query = "";
    searchIndex = 0;
    restoring = true;
    void tick().then(() => {
      if (currentTask !== nextTask || !scroller) return;
      const anchored = saved?.anchor && !saved.atEnd ? viewport.restore(saved.anchor) : undefined;
      scroller.scrollTop = anchored ?? restoredThreadTop(saved, scroller.scrollHeight, scroller.clientHeight);
      viewport.scroll();
      lastTop = scroller.scrollTop;
      restoring = false;
    });
  });

  $effect(() => {
    revision;
    live;

    if (restoring) return;

    if (searchOpen) {
      seenMessages = messageCount;
      return;
    }

    if (atBottom) {
      seenMessages = messageCount;
      unread = 0;
      followEnd();
      return;
    }

    unread = Math.max(0, messageCount - seenMessages);
  });

  $effect(() => {
    const element = scroller;
    if (!element) return;
    if (!threadInner) return;
    return viewport.attach(element, threadInner, () => atBottom && !searchOpen, () => {
      if (!restoring && atBottom && !searchOpen) followEnd();
    });
  });

  $effect(() => {
    if (!searchOpen || !activeId) return;
    const id = activeId;
    const key = rowIds[items.findIndex((item) => item.id === id)];
    if (key) untrack(() => viewport.reveal(key));
    void tick().then(() => {
      if (!searchOpen || activeId !== id) return;
      const target = threadInner?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"]`);
      if (!target || !scroller) return;
      scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (scroller.clientHeight - target.clientHeight) / 2;
      viewport.scroll();
    });
  });

  onDestroy(rememberPosition);

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    const onKeydown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey;
      if (
        modifier &&
        !event.altKey &&
        event.key.toLowerCase() === "f" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }
      if (!searchOpen || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    };
    globalThis.addEventListener("keydown", onKeydown, true);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("keydown", onKeydown, true);
    };
  });
</script>

<div
  class="thread"
  bind:this={scroller}
  role="log"
  aria-label={t("Task progress")}
  aria-busy={busy ? "true" : undefined}
  onscroll={onScroll}
>
  {#if searchOpen}
    <ThreadSearch bind:query bind:index={searchIndex} count={hits.length} {focusToken} onClose={closeSearch} />
  {/if}

  <div class="thread-inner" bind:this={threadInner}>
    {#if window.before > 0}<div class="thread-spacer" aria-hidden="true" style:height={`${window.before}px`}></div>{/if}
    {#each visible as item, index (item.id)}
      <div class="thread-slot" class:is-user={item.kind === "message" && window.start + index > 0} data-thread-key={rowIds[window.start + index]} use:viewport.row={rowIds[window.start + index] ?? item.id}>
      <div
        class="thread-item"
        class:is-user={item.kind === "message"}
        class:is-search-hit={hitIds.has(item.id)}
        class:is-search-active={activeId === item.id}
        data-thread-id={item.id}
      >
        {#if item.kind === "message"}
          <UserMessage text={item.text} />
          {#if item.at}
            <time
              class="msg-time"
              datetime={item.at}
              title={timeTitle(item.at, new Date(now))}
            >
              {relativeTime(item.at, new Date(now))}
            </time>
          {/if}
        {:else if item.kind === "run"}
          <RunGroup
            id={item.id}
            summary={item.summary}
            {onOpenChanges}
          />
        {:else if item.kind === "worker-tool"}
          {@const action = toolMirrors.get(item.reference)}
          {#if action}<div class="tool-mirror" data-tool-reference={item.reference}><RunActionRow {action} /></div>{/if}
        {:else if item.kind === "answer"}
          {#if item.text || item.summaryHtml !== undefined}
            {@const parentRun = items[window.start + index - 1]}
            <Answer
              text={item.text}
              completedSummary={item.complete ? item.summaryHtml : undefined}
              tools={toolMirrors}
              streaming={item.streaming ?? false}
              at={item.at}
              {now}
              prompt={parentRun?.kind === "run" ? parentRun.summary.prompt : undefined}
              {onRepeat}
            >
              {#snippet children()}
                {#if item.summaryHtml !== undefined}
                  <HtmlSummary
                    html={item.summaryHtml}
                    complete={item.complete ?? false}
                    onAction={(action) => {
                      if (action.action === "copy") {
                        void copyText(action.payload);
                      } else onNavigateSummary?.(action.destination);
                    }}
                  />
                {/if}
              {/snippet}
            </Answer>
          {/if}
        {:else if item.kind === "approval"}
          <ApprovalCard {item} />
        {:else if item.kind === "notice"}
          <NoticeCard {item} />
        {:else if item.kind === "error"}
          <ErrorCard {item} {onRepeat} />
        {/if}
      </div>
      </div>
    {/each}
    {#if window.after > 0}<div class="thread-spacer" aria-hidden="true" style:height={`${window.after}px`}></div>{/if}

    {#if live}
      <LiveRun label={liveLabel} glow={!reasoningLive} />
      {#if pendingCalls.length > 0}
        <ToolCallProgress calls={pendingCalls} />
      {/if}
    {/if}
  </div>

  {#if !atBottom}
    <div class="jump-wrap" class:is-reviewing={items.some(item => item.kind === "approval" && item.state === "pending")}>
      <button class="jump" type="button" aria-label={jumpLabel} title={jumpLabel} onclick={jumpToBottom}>
        <span>{t("Scroll down")}</span>
        {#if unread > 0}
          <span class="jump-count" aria-hidden="true">{unread}</span>
        {/if}
        <Icon name="chevron-down" size={13} />
      </button>
    </div>
  {/if}
</div>

<style>
  .thread {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-anchor: none;
    scroll-padding-top: 72px;
  }

  .thread-inner {
    max-width: var(--content-w);
    margin: 0 auto;
    padding: 32px 28px 48px;
  }

  .thread-item {
    display: flow-root;
    border-radius: 12px;
  }

  .thread-slot { display: flow-root; }
  .thread-slot.is-user { padding-top: 40px; }
  .thread-spacer { pointer-events: none; }

  .thread-item.is-search-hit {
    outline: 1px solid var(--line-strong);
    outline-offset: 6px;
  }

  .thread-item.is-search-active {
    background: rgba(240, 239, 237, 0.04);
    outline-color: rgba(240, 239, 237, 0.32);
  }

  .msg-time {
    display: block;
    margin-top: 6px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.3;
    text-align: right;
  }

  .jump-wrap {
    position: sticky;
    bottom: 16px;
    z-index: 4;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 0;
    pointer-events: none;
  }

  .jump {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.07),
      0 8px 24px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(240, 239, 237, 0.06);
    color: var(--text-2);
    font-size: 12.5px;
    pointer-events: auto;
    transition:
      background 220ms var(--ease),
      color 220ms var(--ease);
  }

  .jump-wrap.is-reviewing { justify-content: flex-end; padding-right: 20px; }

  .jump:hover {
    background: var(--raised-hover);
    color: var(--text);
  }

  .jump-count {
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(240, 239, 237, 0.1);
    color: var(--text);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .thread-inner :global(a) {
    overflow-wrap: anywhere;
  }

  .thread-inner :global(.msg.user .bubble) {
    overflow-wrap: anywhere;
  }

  @media (max-width: 1220px) {
    .thread-inner {
      padding: 28px 22px 46px;
    }
  }
</style>
