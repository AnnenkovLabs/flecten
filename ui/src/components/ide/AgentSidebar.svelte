<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { RunStore } from "../../lib/run.svelte";
  import { pasteImage, pickAttachments } from "../../lib/desktop";
  import Thread from "../Thread.svelte";
  import Composer from "../Composer.svelte";
  import Icon from "../Icon.svelte";
  import RunStrip from "../RunStrip.svelte";

  let { run, onClose, onShowAgent, onOpenChanges, onCommand, focusToken }: {
    run: RunStore; onClose: () => void; onShowAgent: () => void; onOpenChanges: () => void;
    onCommand: (name: string, args: string) => void; focusToken: number;
  } = $props();
</script>
<aside class="agent-sidebar" aria-label={t("Agent")} id="ide-agent">
  <header><Icon name="brain" size={17} /><h2>{t("Agent")}</h2><span class="connection" title={run.connection === "ready" ? t("Agent connected") : t("Not connected")}>{run.connection === "ready" ? run.busy ? t("Working") : t("Ready") : t("Connecting…")}</span>
    <button type="button" title={t("Open full conversation")} aria-label={t("Open full conversation")} onclick={onShowAgent}><Icon name="layers" size={15} /></button>
    <button type="button" title={t("Hide agent")} aria-label={t("Hide agent")} onclick={onClose}><Icon name="x" size={15} /></button>
  </header>
  {#if run.view.thread.items.length || run.view.live}
    <Thread taskId={run.activeTask} items={run.view.thread.items} live={run.view.live} liveLabel={run.view.liveLabel} pendingCalls={run.view.thread.pendingCalls} busy={run.busy} {onOpenChanges} onRepeat={(prompt) => run.repeat(prompt)} />
  {:else}
    <div class="agent-empty"><Icon name="brain" size={28} /><h3>{t("Working in the same project")}</h3><p>{t("Give the agent a task. Its actions and replies will appear here, while your files stay in view.")}</p></div>
  {/if}
  <div class="agent-composer">
    <RunStrip jobs={run.view.jobs} budget={run.view.budget} />
    <Composer running={run.busy} stopping={run.view.stopping} {focusToken} placeholder={t("Message the agent…")} context={run.contextView}
      commands={run.commands} providers={run.info?.providers ?? []} provider={run.provider} model={run.model}
      reasoning={run.reasoning} variant={run.variant} queued={run.view.queued} sendMode={run.sendMode}
      contexts={run.contextMentions} files={run.files} onRequestFiles={() => void run.loadFiles()} onPickAttachments={pickAttachments} onPasteImage={pasteImage}
      {onCommand} onCompact={(focus) => void run.task.compact(focus)} onModelSelect={(provider, model) => run.setModel(provider, model)}
      onReasoningChange={(value) => run.setReasoning(value)} onVariantChange={(value) => run.setVariant(value)}
      onSend={(text, mode, attachments, contexts) => run.submit(text, mode, attachments, contexts)} onQueueEdit={(id, text) => run.task.editQueued(id, text)}
      onQueueRemove={(id) => run.task.removeQueued(id)} onSendModeChange={(mode) => run.setSendMode(mode)} onStop={() => run.stop()} />
  </div>
</aside>
<style>
  .agent-sidebar { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; background: var(--bg); border-left: 1px solid var(--line); }
  header { display: flex; align-items: center; flex: none; gap: 8px; padding: 0 8px 0 16px; min-height: 44px; border-bottom: 1px solid var(--line); color: var(--text-2); }
  h2 { font-size: 13px; font-weight: 600; color: var(--text); }
  .connection { flex: 1; font-size: 12px; color: var(--muted); text-align: right; padding-right: 6px; }
  header button { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 5px; color: var(--muted); transition: color 150ms var(--ease), background 150ms var(--ease); }
  header button:hover { background: var(--raised); color: var(--text); }
  .agent-empty { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: start; justify-content: center; gap: 14px; padding: 28px; color: var(--muted); }
  h3 { font-size: 17px; color: var(--text-2); font-weight: 500; letter-spacing: -.02em; }
  .agent-empty p { max-width: 32ch; color: var(--muted); font-size: 13px; line-height: 1.7; }
  .agent-composer { flex: none; min-width: 0; }
  .agent-sidebar :global(.thread-inner) { padding: 22px 20px 32px; }
  .agent-sidebar :global(.thread-item), .agent-sidebar :global(.thread-item *) { animation: none !important; }
  .agent-sidebar :global(.answer), .agent-sidebar :global(.user-message) { font-size: 14px; line-height: 1.65; }
  .agent-sidebar :global(.composer-wrap) { padding: 10px 12px 16px; }
  .agent-sidebar :global(.composer) { padding: var(--space-3); border-radius: 12px; transition: box-shadow 150ms var(--ease); }
  .agent-sidebar :global(.composer:focus-within) { border-radius: 12px; }
  .agent-sidebar :global(.composer-wrap::before) { height: 24px; top: -24px; }
  .agent-sidebar :global(.prompt-editor) { font-size: 14px; }
  @media(max-height: 700px) { .agent-empty { padding: 20px; gap: 10px; } .agent-empty h3 { font-size: 16px; } }
</style>
