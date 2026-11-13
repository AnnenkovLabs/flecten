<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { onDestroy } from "svelte";
  import { requestAgent } from "../../lib/desktop";
  import type { AgentEvent } from "../../lib/types";
  import { type LocalVoiceOptions, VOSK_MODELS, WHISPER_MODELS } from "../../lib/voice-settings";
  import Icon from "../Icon.svelte";
  import SettingsRow from "./SettingsRow.svelte";

  let { engine, options }: { engine: "faster-whisper" | "vosk"; options: LocalVoiceOptions } = $props();
  let busy = $state<"check" | "prepare" | null>(null);
  let message = $state("");
  let failed = $state(false);
  let request: string | null = null;
  type Response = Extract<AgentEvent, { type: "response" }>;

  function clearResult(): void { message = ""; failed = false; }

  async function setup(action: "check" | "prepare"): Promise<void> {
    if (busy) return;
    const id = crypto.randomUUID();
    request = id;
    busy = action;
    message = action === "prepare" ? t("Installing the engine and downloading the model. This may take a few minutes…") : t("Checking the local installation…");
    failed = false;
    try {
      const response = await requestAgent<Response>({ type: action === "check" ? "voice.check" : "voice.prepare",
        id, engine, local: $state.snapshot(options) }, action === "prepare" ? 905_000 : 20_000);
      if (request !== id) return;
      if (!response.voiceSetup) throw new Error(t("Could not get the engine status."));
      message = response.voiceSetup.message;
      failed = !response.voiceSetup.ready;
    } catch (error) {
      if (request !== id) return;
      message = error instanceof Error ? error.message : t("Could not set up the local engine.");
      failed = true;
    } finally { if (request === id) { request = null; busy = null; } }
  }

  function cancel(): void {
    const id = request;
    request = null;
    busy = null;
    message = t("Installation canceled. Downloaded models are kept.");
    if (id) void requestAgent({ type: "voice.cancel", id }).catch(() => undefined);
  }
  onDestroy(() => { if (request) cancel(); });
</script>

{#if engine === "faster-whisper"}
  <SettingsRow title={t("Local model")} stacked>
    <select class="st-input" style="width: min(100%, 400px)" aria-label={t("Local faster-whisper model")} bind:value={options.whisperModel} disabled={!!busy} onchange={clearResult}>
      {#each WHISPER_MODELS as model}<option value={model.value}>{model.label}</option>{/each}
    </select>
  </SettingsRow>
  <SettingsRow title={t("Processing")}>
    <select class="st-input" aria-label={t("Speech recognition processing")} bind:value={options.device} disabled={!!busy} onchange={clearResult}>
      <option value="cpu">{t("CPU")}</option><option value="cuda">{t("NVIDIA GPU")}</option>
    </select>
  </SettingsRow>
{:else}
  <SettingsRow title={t("Vosk language and model")} stacked>
    <select class="st-input" aria-label={t("Local Vosk model")} bind:value={options.voskModel} disabled={!!busy} onchange={clearResult}>
      {#each VOSK_MODELS as model}<option value={model.value}>{model.label}</option>{/each}
    </select>
  </SettingsRow>
{/if}
<div class="local-voice-setup">
  <p>{t("After installation, audio is processed on this computer.")}</p>
  <div class="local-voice-actions">
    <button type="button" class="st-btn st-btn--quiet" disabled={!!busy} onclick={() => void setup("check")}>{t("Check installation")}</button>
    <button type="button" class="st-btn st-btn--quiet" disabled={!!busy || !options.python.trim()} onclick={() => void setup("prepare")}>{t("Install engine and model")}</button>
    {#if busy}<button type="button" class="st-btn st-btn--quiet" onclick={cancel}>{t("Cancel")}</button>{/if}
  </div>
  {#if message}<p class:failed role="status">{message}</p>{/if}
  <details class="st-details">
    <summary>{t("Installation options")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
    <div class="st-details-body">
      <SettingsRow title={t("Python for installation")} description={t("Python 3.9+ with the venv module.")} stacked>
        <input class="st-input" aria-label={t("Python for voice input")} bind:value={options.python} disabled={!!busy} placeholder={t("python3 or full path")} oninput={clearResult} />
      </SettingsRow>
      {#if engine === "faster-whisper" && options.device === "cuda"}
        <p>{t("NVIDIA requires CUDA 12 and cuDNN 9.")}</p>
      {/if}
    </div>
  </details>
</div>

<style>
  .local-voice-setup { padding: 12px 16px 16px; display: grid; gap: 12px; }
  p { color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .local-voice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .local-voice-actions button { min-height: 40px; }
  .failed { color: var(--error); }
</style>
