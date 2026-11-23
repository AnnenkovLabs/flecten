<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { userPrompts } from "../../lib/composer/prompt-history";
  import type { RunStore } from "../../lib/run.svelte";
  import { conversationLiveState } from "../../lib/run/worker-mirrors";
  import { pasteImage, pickAttachments } from "../../lib/desktop";
  import Thread from "../Thread.svelte";
  import Composer from "../Composer.svelte";
  import ApprovalDock from "../ApprovalDock.svelte";
  import Icon from "../Icon.svelte";
  import RunStrip from "../RunStrip.svelte";

  let { run, onClose, onShowAgent, onOpenChanges, onCommand, focusToken }: {
    run: RunStore; onClose: () => void; onShowAgent: () => void; onOpenChanges: () => void;
    onCommand: (name: string, args: string) => void; focusToken: number;
  } = $props();
  const conversationLive = $derived(conversationLiveState(run.view));
</script>
<aside class="agent-sidebar" aria-label={t("Agent")} id="ide-agent">
  <header><Icon name="brain" size={16} /><h2>{t("Agent")}</h2><span class="connection" data-tooltip={run.connection === "ready" ? t("Agent connected") : t("Not connected")}>{run.connection === "ready" ? run.busy ? t("Working") : t("Ready") : t("Connecting…")}</span>
    <button type="button" data-tooltip={t("Open full conversation")} aria-label={t("Open full conversation")} onclick={onShowAgent}><Icon name="layers" size={14} /></button>
    <button type="button" data-tooltip={t("Hide agent")} aria-label={t("Hide agent")} onclick={onClose}><Icon name="x" size={14} /></button>
  </header>
  {#if run.view.thread.items.length || conversationLive.live}
    <Thread taskId={run.activeTask} items={run.history.items} historyDisabled={run.history.blocked} live={conversationLive.live} liveLabel={conversationLive.liveLabel} retryUntil={conversationLive.retryUntil} pendingCalls={conversationLive.pendingCalls} busy={run.busy} {onOpenChanges} onSummaryInteraction={run.task.summaryInteraction} onRepeat={(prompt) => run.repeat(prompt)} onEditMessage={(id, text) => run.history.begin(id, text)} onSelectVersion={(id, variant) => run.history.select(id, variant)} />
  {:else}
    <div class="agent-empty"><Icon name="brain" size={26} /><h3>{t("Working in the same project")}</h3><p>{t("Give the agent a task. Its actions and replies will appear here, while your files stay in view.")}</p></div>
  {/if}
  <div class="agent-composer">
    <RunStrip jobs={run.view.jobs} budget={run.view.taskBudget ?? run.view.budget} />
    <ApprovalDock items={run.view.thread.items} />
    <Composer running={run.busy} isTalker={run.view.isTalker} stopping={run.view.stopping} {focusToken} placeholder={t("Message the agent…")} context={run.contextView}
      editing={run.history.editing} editBlocked={run.history.blocked} onCancelEdit={() => run.history.cancel()}
      onSaveEdit={(text, attachments, contexts, retained) => run.history.save(text, attachments, contexts, retained)}
      canContinue={run.controls.canContinue} controlCooldown={run.controls.coolingDown} onContinue={() => run.controls.continue()}
      commands={run.commands} providers={run.info?.providers ?? []} provider={run.provider} model={run.model}
      reasoning={run.reasoning} variant={run.variant} queued={run.view.queued} sendMode={run.sendMode}
      contexts={run.contextMentions} files={run.files} historyPrompts={userPrompts(run.history.items)} onRequestFiles={() => void run.loadFiles()} onPickAttachments={pickAttachments} onPasteImage={pasteImage}
      {onCommand} onCompact={(focus) => void run.task.compact(focus)} onModelSelect={(provider, model) => run.setModel(provider, model)}
      onReasoningChange={(value) => run.setReasoning(value)} onVariantChange={(value) => run.setVariant(value)}
      onSend={(text, mode, attachments, contexts) => run.submit(text, mode, attachments, contexts)} onQueueEdit={(id, text) => run.task.editQueued(id, text)}
      onQueueRemove={(id) => run.task.removeQueued(id)} onSendModeChange={(mode) => run.setSendMode(mode)} onStop={() => run.stop()} />
  </div>
</aside>
<style>
  .agent-sidebar { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; background: var(--bg); }
  header { display: flex; align-items: center; flex: none; gap: 6px; padding: 0 6px 0 12px; min-height: 34px; border-bottom: 1px solid var(--line); background: var(--sidebar); color: var(--text-2); }
  h2 { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .connection { flex: 1; font-size: 11.5px; color: var(--muted); text-align: right; padding-right: 4px; }
  header button { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 5px; color: var(--muted); transition: color 150ms var(--ease), background 150ms var(--ease); }
  header button:hover { background: var(--raised); color: var(--text); }
  .agent-empty { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: start; justify-content: center; gap: 10px; padding: 24px; color: var(--muted); }
  h3 { font-size: 15px; color: var(--text-2); font-weight: 500; letter-spacing: -.015em; }
  .agent-empty p { max-width: 32ch; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
  .agent-composer { flex: none; min-width: 0; }
  .agent-sidebar :global(.approval-dock) { padding-inline: 10px; }
  .agent-sidebar :global(.thread-inner) { padding: 16px 14px 24px; }
  .agent-sidebar :global(.thread-item), .agent-sidebar :global(.thread-item *) { animation: none !important; }
  .agent-sidebar :global(.answer), .agent-sidebar :global(.user-message) { font-size: 13.5px; line-height: 1.6; }
  .agent-sidebar :global(.composer-wrap) { padding: 6px 10px 10px; }
  .agent-sidebar :global(.composer-wrap::before) { height: 18px; top: -18px; }
  .agent-sidebar :global(.composer) { padding: 8px 10px 7px; border-radius: 12px; transition: box-shadow 150ms var(--ease); }
  .agent-sidebar :global(.composer:focus-within) { border-radius: 12px; }
  .agent-sidebar :global(.prompt-editor) { min-height: 24px; padding: 2px 2px 6px; font-size: 13.5px; line-height: 1.45; }
  .agent-sidebar :global(.composer-bar) { --action-size: 28px; row-gap: 4px; column-gap: 6px; }
  .agent-sidebar :global(.composer-left) { flex-wrap: nowrap; overflow: hidden; gap: 2px; }
  .agent-sidebar :global(.composer-right) { gap: 2px; }
  .agent-sidebar :global(.composer-bar .attach),
  .agent-sidebar :global(.composer-bar .voice),
  .agent-sidebar :global(.composer-bar .voice-cancel),
  .agent-sidebar :global(.composer-action-set button) { width: 28px; height: 28px; border-radius: 6px; }
  .agent-sidebar :global(.model-picker) { flex: 0 1 auto; min-width: 0; }
  .agent-sidebar :global(.model-picker .model-button) { height: 26px; max-width: 100%; padding: 0 5px; gap: 4px; font-size: 12px; border-radius: 5px; }
  .agent-sidebar :global(.composer-select) { flex: none; height: 26px; padding: 0 5px; gap: 3px; font-size: 11.5px; border-radius: 5px; }
  .agent-sidebar :global(.lh-context-button) { height: 26px; padding: 0 5px; gap: 4px; font-size: 11.5px; border-radius: 5px; }
  .agent-sidebar :global(.lh-context-ring) { width: 14px; height: 14px; }
  @media(max-height: 700px) { .agent-empty { padding: 18px; gap: 8px; } .agent-empty h3 { font-size: 14.5px; } }
  @media(pointer: coarse) {
    header button,
    .agent-sidebar :global(.composer-bar .attach),
    .agent-sidebar :global(.composer-bar .voice),
    .agent-sidebar :global(.composer-bar .voice-cancel),
    .agent-sidebar :global(.composer-action-set button),
    .agent-sidebar :global(.model-picker .model-button),
    .agent-sidebar :global(.composer-select),
    .agent-sidebar :global(.lh-context-button) { height: 40px; min-width: 40px; }
  }
</style>
