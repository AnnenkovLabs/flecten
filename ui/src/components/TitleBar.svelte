<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount } from "svelte";
  import { controlWindow, type UpdaterStatus } from "../lib/desktop";
  import { modLabel } from "../lib/platform";
  import { updater } from "../lib/updater.svelte";
  import Icon from "./Icon.svelte";
  import MorphIcon from "./MorphIcon.svelte";
  import WorkspaceMode from "./WorkspaceMode.svelte";

  interface Props {
    sidebarHidden: boolean;
    onToggleSidebar: () => void;
    onOpenSettings: () => void;
    mode: "agent" | "ide";
    onModeChange: (mode: "agent" | "ide") => void;
  }

  let { sidebarHidden, onToggleSidebar, onOpenSettings, mode, onModeChange }: Props = $props();

  const sidebarLabel = $derived(
    mode === "ide" ? (sidebarHidden ? t("Show files") : t("Hide files")) : (sidebarHidden ? t("Show projects panel") : t("Collapse projects panel")),
  );

  const updaterStatus = $derived(updater.status);
  const showUpdater = $derived(
    updaterStatus !== null && updaterStatus.enabled && updaterStatus.state !== "idle",
  );

  function updateLabel(status: UpdaterStatus): string {
    switch (status.state) {
      case "checking":
        return t("Checking for updates");
      case "available":
        return status.version ? t("Update {0}", [status.version]) : t("Update available");
      case "downloading":
        return t("Downloading {0}%", [status.percent ?? 0]);
      case "downloaded":
        return t("Restart");
      case "error":
        return t("Update error");
      default:
        return t("Update");
    }
  }

  function updateIcon(status: UpdaterStatus): "refresh" | "arrow-up" | "x" {
    if (status.state === "available") return "arrow-up";
    if (status.state === "error") return "x";
    return "refresh";
  }

  function updateTitle(status: UpdaterStatus): string {
    if (status.message) return status.message;
    if (status.state === "available") return t("Download update");
    if (status.state === "downloaded") return t("Install and restart");
    if (status.state === "error") return t("Check again");
    return updateLabel(status);
  }

  async function onUpdateClick(): Promise<void> {
    if (!updaterStatus) return;
    if (updaterStatus.state === "available") {
      await updater.download();
    } else if (updaterStatus.state === "downloaded") {
      await updater.install();
    } else if (updaterStatus.state === "error") {
      await updater.check();
    }
  }

  onMount(() => {
    updater.start();
  });
</script>

<header class="titlebar" data-harness-region="titlebar">
  <div class="tb-left">
    <span class="brand">
      <Icon name="mark" size={17} stroke={1.8} />
      <span translate="no">Flecten</span>
    </span>
    <button
      class="tb-btn"
      type="button"
      aria-label={sidebarLabel}
      title={`${sidebarLabel} (${modLabel}+B)`}
      onclick={onToggleSidebar}
    >
      <Icon name="panel-left" />
    </button>
    <button
      class="tb-btn"
      type="button"
      aria-label={t("Settings")}
      title={t("Settings")}
      onclick={onOpenSettings}
    >
      <Icon name="settings" />
    </button>
    {#if showUpdater && updaterStatus}
      <button
        class="tb-update"
        class:ready={updaterStatus.state === "downloaded"}
        class:error={updaterStatus.state === "error"}
        type="button"
        aria-label={updateTitle(updaterStatus)}
        title={updateTitle(updaterStatus)}
        disabled={updaterStatus.state === "checking" || updaterStatus.state === "downloading"}
        onclick={onUpdateClick}
      >
        <MorphIcon name={updateIcon(updaterStatus)} size={14} />
        <span>{updateLabel(updaterStatus)}</span>
      </button>
    {/if}
  </div>
  <WorkspaceMode {mode} onChange={onModeChange} />
  <div class="tb-right">
    <button
      class="win-btn"
      type="button"
      aria-label={t("Minimize window")}
      onclick={() => controlWindow("minimize")}
    >
      <span class="win-min" aria-hidden="true"></span>
    </button>
    <button
      class="win-btn"
      type="button"
      aria-label={t("Maximize window")}
      onclick={() => controlWindow("maximize")}
    >
      <span class="win-max" aria-hidden="true"></span>
    </button>
    <button
      class="win-btn win-close"
      type="button"
      aria-label={t("Close window")}
      onclick={() => controlWindow("close")}
    >
      <Icon name="x" />
    </button>
  </div>
</header>

<style>
  .titlebar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    justify-content: space-between;
    background: var(--sidebar);
    user-select: none;
    -webkit-app-region: drag;
  }

  .tb-left,
  .tb-right,
  .brand {
    display: flex;
    align-items: center;
  }

  .tb-left {
    gap: 6px;
    padding-left: 14px;
  }

  .brand {
    gap: 8px;
    margin-right: 8px;
    color: var(--primary);
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .brand span:nth-child(2) {
    color: var(--text);
  }

  .tb-btn,
  .win-btn {
    display: grid;
    place-items: center;
    color: var(--text-2);
    -webkit-app-region: no-drag;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

  .tb-btn {
    width: 40px;
    height: 40px;
    border-radius: 6px;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .tb-btn :global(.icon) {
    transition: transform 460ms var(--ease-jelly);
  }

  .tb-btn:hover {
    border-radius: 11px;
    background: rgba(240, 239, 237, 0.06);
    color: var(--text);
  }

  .tb-btn:hover :global(.icon) {
    transform: scale(1.08) rotate(7deg);
  }

  .tb-update {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    max-width: 230px;
    margin-left: 4px;
    padding: 0 10px;
    border-radius: 6px;
    background: rgba(240, 239, 237, 0.06);
    color: var(--text-2);
    font-size: 12.5px;
    font-weight: 600;
    -webkit-app-region: no-drag;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .tb-update span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-update:hover:not(:disabled) {
    border-radius: 9px;
    background: rgba(240, 239, 237, 0.1);
    color: var(--text);
  }

  .tb-update:disabled {
    opacity: 0.75;
  }

  .tb-update.ready {
    color: var(--primary);
  }

  .tb-update.error {
    color: var(--error);
  }

  .tb-right {
    height: 100%;
    justify-self: end;
  }
  @media (max-width: 600px) {
    .brand { display: none; }
    .tb-left { padding-left: 4px; gap: 0; }
    .win-btn { width: 40px; }
    .tb-update { display: none; }
  }

  .win-btn {
    width: 48px;
    height: 100%;
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 320ms var(--ease-jelly);
  }

  .win-btn:hover {
    border-radius: 9px;
    background: rgba(240, 239, 237, 0.08);
    color: var(--text);
  }

  .win-close:hover {
    background: #c42b1c;
    color: #fff;
  }

  .win-btn :global(.icon),
  .win-min {
    transition: transform 460ms var(--ease-jelly);
  }

  .win-max {
    transition:
      transform 460ms var(--ease-jelly),
      border-radius 460ms var(--ease-jelly);
  }

  .win-btn:hover :global(.icon) {
    transform: scale(1.12);
  }

  .win-btn:hover .win-max {
    border-radius: 4px;
    transform: scale(1.05);
  }

  .win-btn:hover .win-min {
    transform: scaleX(1.18);
  }

  .win-min {
    width: 10px;
    height: 1px;
    background: currentColor;
  }

  .win-max {
    width: 9px;
    height: 9px;
    border: 1px solid currentColor;
    border-radius: 2px;
  }
</style>
