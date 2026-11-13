<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { SendMode } from "../lib/composer/types";
  import type { ContextView } from "../lib/context-meter.svelte";
  import { REASONING_LABELS } from "../lib/settings-utils";
  import type { ProviderInfo, ReasoningChoice, ReasoningEffort } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import ContextMeter from "./composer/ContextMeter.svelte";
  import ComposerSelect from "./composer/ComposerSelect.svelte";
  import "./composer/composer-bar.css";

  interface Props {
    running: boolean;
    stopping: boolean;
    hasDraft: boolean;
    canSend: boolean;
    voiceSupported: boolean;
    voiceListening: boolean;
    voicePending?: boolean;
    voiceActive: boolean;
    voiceStatus: string;
    voiceProvider: string;
    context: ContextView;
    onCompact?: ((focus?: string) => void) | undefined;
    providers: ProviderInfo[];
    provider: string;
    model: string;
    reasoning: ReasoningChoice;
    variant?: string | undefined;
    onSend: (mode: SendMode) => void;
    onAttach: () => void;
    onVoiceStart: () => void;
    onVoiceStop: () => void;
    onVoiceCancel: () => void;
    onModelSelect: (provider: string, model: string) => void;
    onReasoningChange: (value: ReasoningChoice) => void;
    onVariantChange: (value: string | undefined) => void;
    onStop: () => void;
  }

  let {
    running,
    stopping,
    hasDraft,
    canSend,
    voiceSupported,
    voiceListening,
    voicePending = false,
    voiceActive,
    voiceStatus,
    voiceProvider,
    context,
    onCompact,
    providers,
    provider,
    model,
    reasoning,
    variant,
    onSend,
    onAttach,
    onVoiceStart,
    onVoiceStop,
    onVoiceCancel,
    onModelSelect,
    onReasoningChange,
    onVariantChange,
    onStop,
  }: Props = $props();

  const activeModel = $derived(
    providers.find((entry) => entry.id === provider)?.models[model],
  );
  const toggle = $derived(activeModel?.reasoningMode === "toggle");
  const levels = $derived<ReasoningEffort[]>(
    toggle
      ? ["none"]
      : activeModel?.reasoningLevels && activeModel.reasoningLevels.length > 0
        ? activeModel.reasoningLevels
        : ["low", "medium", "high"],
  );
  const hasReasoning = $derived(activeModel?.reasoning !== false);
  const variants = $derived(
    activeModel?.variants ? Object.entries(activeModel.variants) : [],
  );
  const current = $derived(
    reasoning !== "auto" && levels.includes(reasoning) ? reasoning : "auto",
  );
  const reasoningOptions = $derived([
    { value: "auto", label: t("auto") },
    ...levels.map((level) => ({ value: level, label: REASONING_LABELS[level] ?? level })),
  ]);
  const variantOptions = $derived([
    { value: "", label: t("Default variant") },
    ...variants.map(([id, entry]) => ({ value: id, label: entry.name ?? id })),
  ]);

  const stopLabel = $derived(stopping ? t("Force stop") : t("Stop"));
  const voiceTitle = $derived(
    !voiceSupported
      ? t("Audio recording is unavailable. Check microphone access.")
      : running
        ? t("Voice input is unavailable while the agent is working")
        : voiceActive
          ? t("{0}{1}. Escape cancels", [voiceStatus, voiceProvider ? ` · ${voiceProvider}` : ""])
          : t("Voice input"),
  );
</script>

<div class="composer-bar">
  <div class="composer-left">
    <button
      class="attach"
      type="button"
      aria-label={t("Attach files")}
      title={t("Attach files, folders, images, or PDFs")}
      onclick={onAttach}
    >
      <Icon name="attachment" size={15} />
    </button>
    <ModelPicker
      {providers}
      {provider}
      {model}
      disabled={running}
      listenOpenRequests
      onSelect={onModelSelect}
    />
    {#if variants.length > 0}
      <ComposerSelect label={t("Model variant")} value={variant ?? ""} options={variantOptions}
        disabled={running} onChange={(value) => onVariantChange(value || undefined)} />
    {/if}
    {#if hasReasoning}
      <ComposerSelect label={t("Model reasoning level")} value={current} options={reasoningOptions}
        disabled={running} onChange={(value) => onReasoningChange(value as ReasoningChoice)} />
    {/if}
  </div>
  <div class="composer-right">
    <ContextMeter view={context} {running} {onCompact} />
    {#if voiceActive}
      <button class="stop" type="button" aria-label={t("Cancel")}
        title={t("Cancel voice input (Escape)")} onclick={onVoiceCancel}>
        <Icon name="x" size={15} />
      </button>
    {/if}
    <button
      class="voice"
      class:is-listening={voiceListening}
      type="button"
      aria-label={voiceListening ? t("Stop voice input") : t("Voice input")}
      aria-pressed={voiceListening}
      title={voiceTitle}
      disabled={!voiceSupported || running || voicePending}
      onclick={voiceListening ? onVoiceStop : onVoiceStart}
    >
      <Icon name="mic" size={14} />
    </button>
    {#if running}
      <div class="composer-actions" class:is-split={hasDraft} role="group" aria-label={t("Agent actions")}>
        <button class="stop" class:is-stopping={stopping} type="button" aria-label={stopLabel}
          title={stopping ? t("Waiting for the current step to finish. Click again to stop immediately") : t("Stop after the current response or command")}
          onclick={onStop}>
          <Icon name="stop" size={16} stroke={2} />
        </button>
        {#if hasDraft}
          <button class="queue-send" type="button" aria-label={t("Add to queue")} title={t("Queue: send when the current run finishes")}
            disabled={!canSend} onclick={() => onSend("queue")}><Icon name="tasks" size={16} /></button>
          <button class="steer-send" type="button" aria-label={t("Guide now")} title={t("Guide now: send at the next safe point")}
            disabled={!canSend} onclick={() => onSend("steer")}><Icon name="spark" size={16} /></button>
        {/if}
      </div>
      <span class="sr-only" role="status">{stopping ? t("Stopping after the current step. Click again to stop it immediately.") : ""}</span>
    {:else}
      <button class="send" type="submit" aria-label={t("Send")} title={t("Send")} disabled={!canSend}>
        <span class="send-face"><Icon name="arrow-up" size={16} stroke={2} /></span>
      </button>
    {/if}
  </div>
</div>
