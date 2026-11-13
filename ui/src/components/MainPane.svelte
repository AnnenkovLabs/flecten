<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { PickedFile } from "../lib/composer/attachments";
  import type { MentionItem, QueuedMessage, SendMode, SkillCommand } from "../lib/composer/types";
  import type { ContextReference } from "../lib/composer/context-types";
  import type { ContextView } from "../lib/context-meter.svelte";
  import type { NewSessionTask } from "../lib/new-session";
  import type { SummaryDestination } from "../lib/markdown/summary-navigation";
  import type {
    AgentBudget,
    AgentJob,
    PendingToolCall,
    ProviderInfo,
    ReasoningChoice,
    ThreadItem,
  } from "../lib/types";
  import Composer from "./Composer.svelte";
  import NewSession from "./new-session/NewSession.svelte";
  import RunStrip from "./RunStrip.svelte";
  import Toast from "./Toast.svelte";
  import Thread from "./Thread.svelte";

  interface ComposerConfig {
    context: ContextView;
    commands: readonly SkillCommand[];
    providers: ProviderInfo[];
    provider: string;
    model: string;
    reasoning: ReasoningChoice;
    variant?: string | undefined;
  }

  interface Props {
    taskId: string;
    project: string;
    cwd: string;
    stopping: boolean;
    items: ThreadItem[];
    live: boolean;
    liveLabel: string;
    pendingCalls: PendingToolCall[];
    busy: boolean;
    focusToken: number;
    composer: ComposerConfig;
    onOpenChanges: () => void;
    onNavigateSummary: (destination: SummaryDestination) => void;
    onRepeat: (prompt?: string) => void;
    onModelSelect: (provider: string, model: string) => void;
    onReasoningChange: (value: ReasoningChoice) => void;
    onVariantChange: (value: string | undefined) => void;
    queued: QueuedMessage[];
    sendMode: SendMode;
    files: string[];
    contexts: MentionItem[];
    tasks: NewSessionTask[];
    onRequestFiles: () => void;
    onCommand: (name: string, args: string) => void;
    onPickAttachments: () => Promise<PickedFile[]>;
    onPasteImage: () => Promise<PickedFile | null>;
    onCompact: (focus?: string) => void;
    onSend: (text: string, mode: SendMode, attachments: string[], contexts: ContextReference[]) => boolean;
    onSelectTask: (id: string) => void;
    onChooseFolder: () => void;
    onQueueEdit: (id: string, text: string) => void;
    onQueueRemove: (id: string) => void;
    onSendModeChange: (mode: SendMode) => void;
    onStop: () => void;
    jobs: AgentJob[];
    budget: AgentBudget | null;
  }

  let {
    taskId,
    project,
    cwd,
    stopping,
    items,
    live,
    liveLabel,
    pendingCalls,
    busy,
    focusToken,
    composer,
    onOpenChanges,
    onNavigateSummary,
    onRepeat,
    onModelSelect,
    onReasoningChange,
    onVariantChange,
    queued,
    sendMode,
    files,
    contexts,
    tasks,
    onRequestFiles,
    onCommand,
    onPickAttachments,
    onPasteImage,
    onCompact,
    onSend,
    onSelectTask,
    onChooseFolder,
    onQueueEdit,
    onQueueRemove,
    onSendModeChange,
    onStop,
    jobs,
    budget,
  }: Props = $props();
</script>

{#snippet heroComposer()}
  {@render composerView("hero")}
{/snippet}

{#snippet composerView(layout: "dock" | "hero")}
  <Composer
    running={busy}
    {stopping}
    {focusToken}
    {layout}
    placeholder={layout === "hero" ? t("Describe the task…") : t("Message the agent…")}
    context={composer.context}
    commands={composer.commands}
    providers={composer.providers}
    provider={composer.provider}
    model={composer.model}
    reasoning={composer.reasoning}
    variant={composer.variant}
    {sendMode}
    {queued}
    {files}
    {contexts}
    {onRequestFiles}
    {onCommand}
    {onCompact}
    {onPickAttachments}
    {onPasteImage}
    {onModelSelect}
    {onReasoningChange}
    {onVariantChange}
    {onSend}
    {onQueueEdit}
    {onQueueRemove}
    {onSendModeChange}
    {onStop}
  />
{/snippet}

<section class="main" id="pane-thread" role={items.length > 0 || live ? "tabpanel" : undefined}
  aria-labelledby={items.length > 0 || live ? "tab-thread" : undefined}>
  {#if items.length === 0 && !live}
    <NewSession
      project={{ id: "current", name: project, path: cwd }}
      recentProjects={[{ id: "current", name: project, path: cwd }]}
      {tasks}
      {busy}
      composer={heroComposer}
      onSelectProject={() => onChooseFolder()}
      {onChooseFolder}
      {onSelectTask}
    />
    <!-- The start screen keeps its greeting and project in view: notices rise from the bottom. -->
    <div class="dock is-edge"><Toast /></div>
  {:else}
    <Thread
      {taskId}
      {items}
      {live}
      {liveLabel}
      {pendingCalls}
      {busy}
      {onOpenChanges}
      {onNavigateSummary}
      {onRepeat}
    />
    <div class="dock">
      <Toast />
      <RunStrip {jobs} {budget} />
      {@render composerView("dock")}
    </div>
  {/if}
</section>

<style>
  /* Composer with the run strip: notices rise above it instead of covering it. */
  .dock {
    position: relative;
    flex: none;
  }

  .dock.is-edge {
    bottom: 18px;
    height: 0;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background:
      linear-gradient(180deg, rgba(240, 239, 237, 0.035), transparent 220px),
      var(--bg);
  }
</style>
