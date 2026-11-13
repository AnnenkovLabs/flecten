<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { requestAgent } from "../../lib/desktop";
  import packageJson from "../../../../package.json?raw";
  import { settings } from "../../lib/settings.svelte";
  import { configScope, diagnosticsPath } from "../../lib/settings-utils";
  import { updater } from "../../lib/updater.svelte";
  import CatalogBar from "../CatalogBar.svelte";
  import CopyButton from "../CopyButton.svelte";
  import Icon from "../Icon.svelte";

  function currentVersion(): string {
    try {
      const parsed = JSON.parse(packageJson) as { version?: unknown };
      return typeof parsed.version === "string" ? parsed.version : t("unknown");
    } catch {
      return t("unknown");
    }
  }

  function secretBackendLabel(value: string | undefined): string {
    if (value === "keychain") return "Keychain";
    if (value === "file") return t("File");
    return value || t("unknown");
  }

  const VERSION = currentVersion();
  const config = $derived(settings.settings);
  const scope = $derived({ ...configScope(settings.info?.cwd), path: settings.info?.configPath ?? configScope(settings.info?.cwd).path });
  const diagnostics = $derived(diagnosticsPath(settings.info?.cwd));
  let bundlePath = $state("");
  let copyError = $state("");

  async function reportText(): Promise<string> {
    const response = await requestAgent({ type: "diagnostics.export" });
    if (!response.ok || !response.diagnostics) throw new Error(response.error ?? t("Could not collect diagnostics. Try again."));
    bundlePath = response.diagnostics.path;
    return JSON.stringify(response.diagnostics.report, null, 2);
  }

  type UpdatePatch = {
    channel?: "stable" | "beta";
    feedUrl?: string | undefined;
    github?: { owner: string; repo: string } | undefined;
    autoCheck?: boolean;
    autoDownload?: boolean;
    installOnQuit?: boolean;
  };

  function patchUpdate(patch: UpdatePatch): void {
    if (!config) return;
    const feedUrl = patch.feedUrl !== undefined ? patch.feedUrl : config.update?.feedUrl;
    const github = patch.github !== undefined ? patch.github : config.update?.github;
    config.update = {
      channel: patch.channel ?? config.update?.channel ?? "stable",
      autoCheck: patch.autoCheck ?? config.update?.autoCheck ?? true,
      autoDownload: patch.autoDownload ?? config.update?.autoDownload ?? true,
      installOnQuit: patch.installOnQuit ?? config.update?.installOnQuit ?? true,
      ...(feedUrl ? { feedUrl } : {}),
      ...(github ? { github } : {}),
    };
  }

  function patchGithub(field: "owner" | "repo", value: string): void {
    const current = config?.update?.github ?? { owner: "", repo: "" };
    const next = { ...current, [field]: value.trim() };
    patchUpdate({ github: next.owner && next.repo ? next : undefined });
  }

  const updateBusy = $derived(
    updater.status?.state === "checking" || updater.status?.state === "downloading",
  );
  const updateConfigured = $derived(updater.status !== null && updater.status.enabled);

  function updateStateLabel(): string {
    const status = updater.status;
    if (!status || !status.enabled) return t("This build does not include an update feed.");
    switch (status.state) {
      case "checking":
        return t("Checking for updates");
      case "available":
        return status.version ? t("Update {0}", [status.version]) : t("Update available");
      case "downloading":
        return t("Downloading {0}%", [status.percent ?? 0]);
      case "downloaded":
        return status.version ? t("Version {0} is ready to install.", [status.version]) : t("Install and restart");
      case "error":
        return status.message ?? t("Update error");
      default:
        return t("Up to date");
    }
  }

  function updateActionLabel(): string {
    const state = updater.status?.state;
    if (state === "available") return t("Download update");
    if (state === "downloaded") return t("Install and restart");
    return t("Check now");
  }

  async function onUpdateAction(): Promise<void> {
    const state = updater.status?.state;
    if (state === "available") await updater.download();
    else if (state === "downloaded") await updater.install();
    else await updater.check();
  }
</script>

<section class="settings-section" aria-labelledby="settings-about">
  <h2 id="settings-about">{t("About")}</h2>

  <div class="st-card">
    <div class="st-about-row">
      <span>{t("Version")}</span>
      <span>{VERSION}</span>
    </div>
  </div>

  <details class="st-details">
    <summary>{t("Diagnostics")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
    <div class="st-details-body">
      <div class="st-card">
        <div class="st-about-row">
          <span>{t("Working directory")}</span>
          <span class="st-mono wrap">{settings.info?.cwd || t("unknown")}</span>
        </div>
        <div class="st-about-row">
          <span>{t("Configuration")}</span>
          <span class="st-mono wrap">{scope.path || t("unknown")}</span>
        </div>
        <div class="st-about-row">
          <span>{t("Diagnostics")}</span>
          <span class="st-mono wrap">{diagnostics || t("unknown")}</span>
        </div>
        <div class="st-about-row">
          <span>{t("Secrets")}</span>
          <span>{secretBackendLabel(settings.info?.secretBackend)}</span>
        </div>
        <div class="st-about-row">
          <span>{t("Directory")}</span>
          <CatalogBar />
        </div>
      </div>

      <div class="about-actions">
        <CopyButton text={reportText} label={t("Copy report")} caption={t("Copy report")} pendingLabel={t("Collecting report")} />
        {#if bundlePath}<span class="st-hint wrap">{t("Saved: {0}", [bundlePath])}</span>{/if}
        {#if copyError}<span class="st-error" role="alert">{copyError}</span>{/if}
      </div>
    </div>
  </details>
  {#if config}
    <div class="st-card update-card">
      <div class="st-about-row">
        <span>{t("Updates")}</span>
        <span class="update-state" class:error={updater.status?.state === "error"}>{updateStateLabel()}</span>
      </div>
      <div class="update-actions">
        <button class="st-btn st-btn--quiet" type="button" disabled={updateBusy || !updateConfigured} onclick={onUpdateAction}>{updateActionLabel()}</button>
      </div>
      <label class="st-field">
        <span class="st-label">{t("Update channel")}</span>
        <select class="st-input" value={config.update?.channel ?? "stable"} onchange={(event) => patchUpdate({ channel: event.currentTarget.value === "beta" ? "beta" : "stable" })}>
          <option value="stable">{t("Stable")}</option>
          <option value="beta">{t("Beta")}</option>
        </select>
      </label>
      <label class="st-switch">
        <span class="st-switch-copy"><strong>{t("Check for updates automatically")}</strong></span>
        <input type="checkbox" checked={config.update?.autoCheck ?? true} onchange={(event) => patchUpdate({ autoCheck: event.currentTarget.checked })} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>
      <label class="st-switch">
        <span class="st-switch-copy"><strong>{t("Download updates automatically")}</strong></span>
        <input type="checkbox" checked={config.update?.autoDownload ?? true} onchange={(event) => patchUpdate({ autoDownload: event.currentTarget.checked })} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>
      <label class="st-switch">
        <span class="st-switch-copy"><strong>{t("Install updates when quitting")}</strong></span>
        <input type="checkbox" checked={config.update?.installOnQuit ?? true} onchange={(event) => patchUpdate({ installOnQuit: event.currentTarget.checked })} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>
      <details class="st-details">
        <summary>{t("Update source")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
        <div class="st-details-body">
          <label class="st-field">
            <span class="st-label">{t("GitHub owner")}</span>
            <input class="st-input" translate="no" value={config.update?.github?.owner ?? ""} placeholder="AnnenkovLabs" onchange={(event) => patchGithub("owner", event.currentTarget.value)} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("GitHub repository")}</span>
            <input class="st-input" translate="no" value={config.update?.github?.repo ?? ""} placeholder="flecten" onchange={(event) => patchGithub("repo", event.currentTarget.value)} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Update feed URL")}</span>
            <input class="st-input" type="url" value={config.update?.feedUrl ?? ""} placeholder="https://" onchange={(event) => patchUpdate({ feedUrl: event.currentTarget.value.trim() || undefined })} />
          </label>
          <p class="st-hint">{t("In packaged builds, empty GitHub fields use the product releases. A feed URL takes priority.")}</p>
        </div>
      </details>
    </div>
    <div class="st-card telemetry-card">
      <label class="st-switch">
        <span class="st-switch-copy"><strong>{t("Send technical metrics")}</strong><span>{t("Event counts, version, and platform only. No messages, files, or keys.")}</span></span>
        <input type="checkbox" checked={config.telemetry?.enabled ?? false} onchange={(event) => { config.telemetry = { ...config.telemetry, enabled: event.currentTarget.checked }; }} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>
      {#if config.telemetry?.enabled}
        <label class="st-field"><span class="st-label">{t("Metrics endpoint")}</span><input class="st-input" type="url" bind:value={config.telemetry.endpoint} placeholder="https://" /></label>
        <p class="st-hint">{t("After saving this setting, use the button to send metrics. The diagnostic report stays on your computer.")}</p>
        <button class="st-btn st-btn--quiet" type="button" disabled={settings.dirty || !config.telemetry.endpoint} onclick={async () => { const response = await requestAgent({ type: "telemetry.send" }); copyError = response.ok ? "" : response.error ?? t("Could not send"); }}>{t("Send metrics")}</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .update-card { display: grid; gap: 12px; padding: 16px; }
  .update-state { text-align: right; overflow-wrap: break-word; }
  .update-state.error { color: var(--error); }
  .update-actions { display: flex; }
  .telemetry-card { display: grid; gap: 12px; padding: 16px; }
  .telemetry-card > * + * { border-top: 0; }
  .about-actions { flex-wrap: wrap; }
</style>
