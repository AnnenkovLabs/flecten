<script lang="ts">
  import { tick } from "svelte";
  import { t } from "../lib/i18n.svelte";
  import type { SendMode } from "../lib/composer/types";
  import type { ContextView } from "../lib/context-meter.svelte";
  import { REASONING_LABELS } from "../lib/settings-utils";
  import type { ProviderInfo, ReasoningChoice, ReasoningEffort } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ModelPicker from "./ModelPicker.svelte";
  import MorphIcon from "./MorphIcon.svelte";
  import ContextMeter from "./composer/ContextMeter.svelte";
  import ComposerSelect from "./composer/ComposerSelect.svelte";
  import "./composer/composer-bar.css";

  interface Props {
    running: boolean;
    isTalker: boolean;
    stopping: boolean;
    canContinue: boolean;
    controlCooldown: boolean;
    onContinue: () => void;
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
    editing?: boolean;
    editPending?: boolean;
  }

  let {
    running,
    isTalker,
    stopping,
    canContinue,
    controlCooldown,
    onContinue,
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
    editing = false,
    editPending = false,
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

  const action = $derived(
    editing ? "save" : running ? "stop" : canContinue && !hasDraft ? "continue" : "send",
  );
  const split = $derived(action === "stop" && hasDraft);
  const actionLabel = $derived({
    save: t("Save & send"),
    stop: stopping ? t("Force stop") : t("Stop"),
    continue: t("Continue"),
    send: t("Send"),
  }[action]);
  const actionTooltip = $derived(
    action === "stop"
      ? stopping
        ? t("Waiting for the current step to finish. Click again to stop immediately")
        : t("Stop after the current response or command")
      : action === "continue"
        ? t("Continue the task where it stopped without starting over")
        : editPending ? t("Saving…") : actionLabel,
  );
  let primary = $state<HTMLButtonElement>();
  let followups = $state<HTMLDivElement>();

  $effect.pre(() => {
    if (split) return;
    const focused = document.activeElement;
    if (!followups?.contains(focused)) return;
    void tick().then(() => {
      if (document.activeElement === focused || document.activeElement === document.body) {
        primary?.focus({ preventScroll: true });
      }
    });
  });

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
      data-tooltip={t("Attach files, folders, images, or PDFs")}
      onclick={onAttach}
      disabled={editPending}
    >
      <Icon name="attachment" size={15} />
    </button>
    <ModelPicker
      {providers}
      {provider}
      {model}
      disabled={running || editPending}
      listenOpenRequests
      onSelect={onModelSelect}
    />
    {#if variants.length > 0}
      <ComposerSelect label={t("Model variant")} value={variant ?? ""} options={variantOptions}
        disabled={running || editPending} onChange={(value) => onVariantChange(value || undefined)} />
    {/if}
    {#if hasReasoning}
      <ComposerSelect label={t("Model reasoning level")} value={current} options={reasoningOptions}
        disabled={running || editPending} onChange={(value) => onReasoningChange(value as ReasoningChoice)} />
    {/if}
  </div>
  <div class="composer-right">
    <ContextMeter view={context} {running} {onCompact} />
    <div class="composer-voice-cancel" class:is-revealed={voiceActive} inert={!voiceActive} aria-hidden={!voiceActive ? true : undefined}>
      <button class="voice-cancel" type="button" aria-label={t("Cancel")}
        data-tooltip={t("Cancel voice input (Escape)")} onclick={onVoiceCancel}>
        <Icon name="x" size={15} />
      </button>
    </div>
    <button
      class="voice"
      class:is-listening={voiceListening}
      type="button"
      aria-label={voiceListening ? t("Stop voice input") : t("Voice input")}
      aria-pressed={voiceListening}
      data-tooltip={voiceTitle}
      disabled={!voiceSupported || running || voicePending || editPending}
      onclick={voiceListening ? onVoiceStop : onVoiceStart}
    >
      <MorphIcon name={voiceListening ? "stop" : "mic"} size={14} />
    </button>
    <div class="composer-action-set" class:composer-actions={action === "stop"} class:is-split={split}
      role={action === "stop" ? "group" : undefined} aria-label={action === "stop" ? t("Agent actions") : undefined}>
      <div class="composer-followups" bind:this={followups} inert={!split} aria-hidden={!split ? true : undefined}>
        <button class="queue-send" type="button" aria-label={t("Add to queue")} data-tooltip={t("Queue: send when the current run finishes")}
          disabled={!canSend} onclick={() => onSend("queue")}><Icon name="tasks" size={16} /></button>
        <button class="steer-send" type={isTalker ? "submit" : "button"} aria-label={t(isTalker ? "Send" : "Guide now")}
          data-tooltip={t(isTalker ? "Send" : "Guide now: send at the next safe point")}
          disabled={!canSend} onclick={isTalker ? undefined : () => onSend("steer")}>
          <Icon name={isTalker ? "arrow-up" : "spark"} size={16} />
        </button>
      </div>
      <button
        bind:this={primary}
        class="composer-primary"
        class:stop={action === "stop"}
        class:send={action !== "stop"}
        class:continue={action === "continue"}
        class:is-stopping={action === "stop" && stopping}
        type={action === "stop" || action === "continue" ? "button" : "submit"}
        aria-label={actionLabel}
        data-tooltip={actionTooltip}
        disabled={action === "stop" ? controlCooldown : action === "continue" ? controlCooldown || voiceActive : !canSend || editPending}
        onclick={action === "stop" ? onStop : action === "continue" ? onContinue : undefined}
      >
        <MorphIcon name={action === "stop" ? "stop" : action === "continue" ? "continue" : "arrow-up"} size={16} stroke={2} />
      </button>
    </div>
    {#if action === "stop"}
      <span class="sr-only" role="status">{stopping ? t("Stopping after the current step. Click again to stop it immediately.") : ""}</span>
    {/if}
  </div>
</div>
