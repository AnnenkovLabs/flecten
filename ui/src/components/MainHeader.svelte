<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { Phase } from "../lib/run-machine";
  import type { WorkspaceSurface } from "../lib/workspace.svelte";
  import type { WorkerItem } from "../lib/types";
  import type { SubagentView } from "../lib/run/subagents.svelte";
  import { subagentStatus } from "../lib/subagent-presentation";
  import Icon from "./Icon.svelte";
  import PanelTabs, { type PanelTab } from "./PanelTabs.svelte";
  import SessionState from "./SessionState.svelte";
  import type { ModuleSurface } from "../../../shared/modules";

  interface Props {
    title: string;
    branch: string;
    phase: Phase;
    surface: WorkspaceSurface;
    changes: number;
    checkpoints: number;
    workers?: WorkerItem[];
    subagents?: SubagentView[];
    moduleSurfaces?: ModuleSurface[];
    split: boolean;
    canSplit: boolean;
    onSelect: (surface: WorkspaceSurface) => void;
    onToggleSplit: () => void;
  }

  let { title, branch, phase, surface, changes, checkpoints, workers = [], subagents = [], moduleSurfaces = [], split, canSplit,
    onSelect, onToggleSplit }: Props = $props();
  const tabs = $derived<PanelTab[]>([
    { id: "thread", label: t("Conversation") },
    { id: "changes", label: t("Changes"), count: changes },
    { id: "history", label: t("History"), count: checkpoints },
    { id: "terminal", label: t("Terminal") },
    ...(workers.length ? [{ id: "worker" as const, label: t("Worker activity"), count: workers.reduce((total, item) => total + item.actions.length, 0) }] : []),
    ...subagents.map((agent) => ({ id: `subagent:${agent.id}` as const, label: agent.name, avatar: agent.avatar, status: subagentStatus(agent.status), state: agent.status })),
    ...moduleSurfaces.map((surface) => ({ id: `module:${surface.module}:${surface.id}` as const, label: surface.title })),
  ]);
</script>

<header class="main-head" data-harness-region="header">
  <div class="title-line">
    <h1 title={title}>{title}</h1>
    {#if branch}
      <span class="branch" title={branch}><Icon name="branch" size={12} /><span>{branch}</span></span>
    {/if}
    {#if surface !== "thread" && !surface.startsWith("subagent:") && !split && phase !== "idle"}
      <SessionState {phase} />
    {/if}
  </div>
  <div class="workspace-tools">
    <PanelTabs {tabs} activeTab={surface} hidden={false} onSelectTab={onSelect} />
    {#if canSplit}
      <button class="split-button" class:is-active={split} type="button"
        aria-pressed={split} aria-label={t("Conversation and panel side by side")}
        title={split ? t("Show only the selected panel") : t("Show the conversation and selected panel side by side")}
        onclick={onToggleSplit}>
        <Icon name="panel-right" size={16} /><span>{t("Side by side")}</span>
      </button>
    {/if}
  </div>
</header>

<style>
  .main-head {
    display: flex;
    flex-direction: column;
    flex: none;
    min-width: 0;
    padding: 22px 28px 0;
    background: var(--bg);
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
  }
  .title-line h1 {
    overflow: hidden;
    color: var(--text);
    font-size: 28px;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 180px;
    margin-left: auto;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
  }
  .branch :global(.icon) { flex: none; }
  .branch span { overflow: hidden; text-overflow: ellipsis; }
  .workspace-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    margin-top: 10px;
  }
  .split-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: var(--control-h);
    padding: 0 8px;
    flex: none;
    border-radius: 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .split-button:hover, .split-button.is-active { background: var(--raised); color: var(--text); }
  @media (max-width: 1220px) {
    .main-head { padding: 16px 22px 0; }
    .title-line h1 { font-size: 24px; }
  }
  @media (max-width: 600px) {
    .main-head { padding-inline: 16px; }
    .title-line { flex-wrap: wrap; gap: 6px 12px; }
    .title-line h1 { font-size: 22px; }
  }
</style>
