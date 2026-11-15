<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import { isModifier } from "../lib/platform";
  import { preferences } from "../lib/preferences.svelte";
  import {
    mentionedPaths,
    mentionEntries,
    type PickedFile,
  } from "../lib/composer/attachments";
  import type { Attachment, MentionItem, QueuedMessage, SendMode, SkillCommand } from "../lib/composer/types";
  import { attachDraftFiles } from "../lib/composer/attachment-draft";
  import { VoiceInput } from "../lib/composer/voice-input.svelte";
  import type { ContextView } from "../lib/context-meter.svelte";
  import { describeDroppedFiles } from "../lib/desktop";
  import { composerDrafts, writeComposerAttachments, writeComposerDraft } from "../lib/composer/drafts.svelte";
  import { toast } from "../lib/toast.svelte";
  import type { ProviderInfo, ReasoningChoice } from "../lib/types";
  import type { ComposerEdit } from "../lib/message-types";
  import { COMPOSER_FOCUS_EVENT, consumeComposerFocus } from "../lib/ui-polish";
  import ComposerBar from "./ComposerBar.svelte";
  import PromptEditor from "./composer/PromptEditor.svelte";
  import type { MentionSpan } from "../lib/composer/prompt-document";
  import type { ContextReference } from "../lib/composer/context-types";
  import { pullRequestMention, resolveMention } from "../lib/composer/context-mentions";
  import AttachmentStrip from "./composer/AttachmentStrip.svelte";
  import MentionMenu from "./composer/MentionMenu.svelte";
  import QueueTray from "./composer/QueueTray.svelte";
  import SlashMenu from "./composer/SlashMenu.svelte";
  import VoiceGlow from "./composer/VoiceGlow.svelte";
  import Icon from "./Icon.svelte";
  import "./composer/composer-frame.css";

  interface Props {
    running: boolean;
    stopping?: boolean;
    canContinue: boolean;
    controlCooldown: boolean;
    onContinue: () => void;
    focusToken: number;
    layout?: "dock" | "hero";
    placeholder?: string;
    context: ContextView;
    providers: ProviderInfo[];
    provider: string;
    model: string;
    reasoning: ReasoningChoice;
    variant?: string | undefined;
    queued: QueuedMessage[];
    sendMode: SendMode;
    files: string[];
    contexts?: MentionItem[];
    commands?: readonly SkillCommand[];
    onRequestFiles: () => void;
    onPickAttachments: () => Promise<PickedFile[]>;
    onPasteImage: () => Promise<PickedFile | null>;
    onCommand: (name: string, args: string) => void;
    onCompact?: ((focus?: string) => void) | undefined;
    onModelSelect: (provider: string, model: string) => void;
    onReasoningChange: (value: ReasoningChoice) => void;
    onVariantChange: (value: string | undefined) => void;
    onSend: (text: string, mode: SendMode, attachments: string[], contexts: ContextReference[]) => boolean | void;
    onQueueEdit: (id: string, text: string) => void;
    onQueueRemove: (id: string) => void;
    onSendModeChange: (mode: SendMode) => void;
    onStop: () => void;
    editing?: ComposerEdit | null | undefined;
    editBlocked?: boolean | undefined;
    onCancelEdit?: (() => void) | undefined;
    onSaveEdit?: ((text: string, attachments: string[], contexts: ContextReference[], retainedAttachments: string[]) => Promise<boolean>) | undefined;
  }

  let {
    running,
    stopping = false,
    canContinue,
    controlCooldown,
    onContinue,
    focusToken,
    layout = "dock",
    placeholder = t("Message the agent…"),
    context,
    providers,
    provider,
    model,
    reasoning,
    variant,
    queued,
    sendMode,
    files,
    contexts = [],
    commands = [],
    onRequestFiles,
    onPickAttachments,
    onPasteImage,
    onCommand,
    onCompact,
    onModelSelect,
    onReasoningChange,
    onVariantChange,
    onSend,
    onQueueEdit,
    onQueueRemove,
    onSendModeChange,
    onStop,
    editing = null,
    editBlocked = false,
    onCancelEdit,
    onSaveEdit,
  }: Props = $props();

  let text = $state("");
  let editor = $state<PromptEditor>();
  let mentions = $state<MentionSpan[]>([]);
  let form: HTMLFormElement;
  let mentionOpen = $state(false);
  let mentionQuery = $state("");
  let mentionStart = 0;
  let slashOpen = $state(false);
  let attachments = $state<Attachment[]>([]);
  let dropActive = $state(false);
  let draftTask = $state("");
  let insertedContext = 0;
  let savingEdit = $state(false);
  let editError = $state(false);
  const activeDraft = $derived(editing?.key ?? composerDrafts.task);
  const voice = $derived(new VoiceInput({
    text: () => text,
    caret: () => editor?.hasFocus() ? editor.caret() : null,
    apply: (next, caret) => {
      editor?.applyText(next, caret);
    },
  }));

  const canSend = $derived(providers.length > 0 && (text.trim().length > 0 || attachments.length > 0));
  const mentionItems = $derived([...pullRequestMention(mentionQuery), ...contexts, ...mentionEntries(files)]);
  const knownPaths = $derived(new Set(files));

  async function pickFiles(): Promise<void> {
    const task = activeDraft;
    attachFiles(task, await onPickAttachments());
  }

  function attachFiles(task: string, files: PickedFile[]): void {
    const current = task === draftTask && task === activeDraft;
    const next = attachDraftFiles(task, files, current ? { text, mentions, attachments, insertImages: (images) => editor?.insertImages(images) } : undefined);
    if (current) attachments = next;
  }

  function onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dropActive = true;
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dropActive = false;
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (dropped.length === 0) return;
    const task = activeDraft;
    const { accepted, missing } = await describeDroppedFiles(dropped);
    attachFiles(task, accepted);
    if (missing > 0) toast.error(t("Some files could not be read. Attach them using the paperclip."));
  }

  async function onPaste(event: ClipboardEvent): Promise<void> {
    const pasted = [...(event.clipboardData?.files ?? [])];
    const hasImage = [...(event.clipboardData?.items ?? [])].some((item) => item.type.startsWith("image/"));
    if (pasted.length === 0 && !hasImage) return;
    event.preventDefault();
    const task = activeDraft;
    const { accepted } = await describeDroppedFiles(pasted);
    if (accepted.length > 0) {
      attachFiles(task, accepted);
      return;
    }
    const image = await onPasteImage();
    if (image) attachFiles(task, [image]);
  }

  $effect(() => {
    const task = activeDraft;
    if (task === draftTask) return;
    voice.cancel();
    draftTask = task;
    text = composerDrafts.values[task] ?? "";
    const saved = composerDrafts.documents[task];
    mentions = saved?.text === text ? saved.mentions : [];
    attachments = composerDrafts.attachments[task] ?? [];
    dropActive = false;
    closeMention();
    slashOpen = false;
    editError = false;
    if (editing) void tick().then(() => editor?.focus());
  });

  $effect(() => {
    const insertion = composerDrafts.insertion;
    if (insertion === insertedContext) return;
    insertedContext = insertion;
    const saved = composerDrafts.documents[activeDraft];
    if (saved && saved.text !== text && activeDraft === draftTask) {
      text = saved.text;
      mentions = saved.mentions;
    }
  });

  $effect(() => {
    if (activeDraft !== draftTask) return;
    writeComposerDraft(text, mentions, draftTask);
    writeComposerAttachments(draftTask, attachments);
  });

  $effect(() => {
    if (focusToken > 0) editor?.focus();
  });

  function focusTextarea(): void {
    if (editor) {
      editor.focus();
      return;
    }
    requestAnimationFrame(() => editor?.focus());
  }

  onMount(() => {
    const onFocusRequest = (): void => {
      consumeComposerFocus();
      focusTextarea();
    };
    const blockNativeDrop = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const onVoiceEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (voice.active) { event.preventDefault(); voice.cancel(); }
      else if (editing) { event.preventDefault(); cancelEdit(); }
    };
    if (consumeComposerFocus()) void tick().then(focusTextarea);
    window.addEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
    window.addEventListener("dragover", blockNativeDrop);
    window.addEventListener("drop", blockNativeDrop);
    window.addEventListener("keydown", onVoiceEscape);
    return () => {
      window.removeEventListener(COMPOSER_FOCUS_EVENT, onFocusRequest);
      window.removeEventListener("dragover", blockNativeDrop);
      window.removeEventListener("drop", blockNativeDrop);
      window.removeEventListener("keydown", onVoiceEscape);
      voice.dispose();
    };
  });

  $effect(() => {
    if (running) voice.cancel();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (editing) { void saveEdit(); return; }
    if (!running && !voice.active && text.trim().length === 0 && attachments.length === 0) {
      if (canContinue && !controlCooldown) onContinue();
      return;
    }
    sendDraft(running ? sendMode : "queue");
  }

  function sendDraft(mode: SendMode): void {
    if (editing) { void saveEdit(); return; }
    if (voice.active || providers.length === 0) return;
    if (text.trim().length === 0 && attachments.length === 0) return;
    const paths = attachments
      .map((attachment) => attachment.path)
      .filter((path): path is string => Boolean(path));
    for (const path of [...mentions.filter((mention) => mention.kind === "file" || mention.kind === "folder" || mention.kind === "image").map((mention) => mention.path), ...mentionedPaths(text, knownPaths)]) {
      if (!paths.includes(path)) paths.push(path);
    }
    if (onSend(text, mode, paths, mentions.flatMap((mention) => mention.context ? [mention.context] : [])) === false) return;
    if (running) onSendModeChange(mode);
    text = "";
    mentions = [];
    // Clear the saved draft now: the hero composer unmounts before its draft effect would run.
    writeComposerDraft("");
    writeComposerAttachments(composerDrafts.task, []);
    attachments = [];
    closeMention();
    slashOpen = false;
    editor?.focus();
  }

  async function saveEdit(): Promise<void> {
    if (!editing || savingEdit || editBlocked || voice.active || !canSend || !onSaveEdit) return;
    savingEdit = true;
    editError = false;
    const paths = attachments.flatMap((attachment) => attachment.path ? [attachment.path] : []);
    const retained = attachments.filter((attachment) => !attachment.path).map((attachment) => attachment.id);
    const references = mentions.flatMap((mention) => mention.context ? [mention.context] : []);
    for (const path of mentions.filter((mention) => mention.kind === "file" || mention.kind === "folder" || mention.kind === "image").map((mention) => mention.path)) if (!paths.includes(path)) paths.push(path);
    try { editError = !(await onSaveEdit(text, paths, references, retained)); }
    catch { editError = true; }
    finally { savingEdit = false; }
  }

  function cancelEdit(): void {
    if (savingEdit) return;
    voice.cancel();
    onCancelEdit?.();
    void tick().then(() => editor?.focus());
  }

  function closeMention(): void {
    mentionOpen = false;
    mentionQuery = "";
  }

  function updateComposerHints(): void {
    if (!editing && text.startsWith("/") && !text.includes("\n")) {
      slashOpen = true;
      closeMention();
      return;
    }
    slashOpen = false;
    updateMention();
  }

  function selectSlash(command: { name: string }, args: string): void {
    onCommand(command.name, args);
    slashOpen = false;
    text = "";
    mentions = [];
    void tick().then(() => editor?.focus());
  }

  function updateMention(): void {
    if (!editor) return;
    const caret = editor.caret();
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0 || mentions.some((mention) => mention.start <= at && at < mention.end)) {
      closeMention();
      return;
    }
    const previous = at === 0 ? " " : before.charAt(at - 1);
    if (previous !== " " && previous !== "\n" && previous !== "\t") {
      closeMention();
      return;
    }
    const query = before.slice(at + 1);
    if (query.includes(" ") || query.includes("\n") || query.includes("\t")) {
      closeMention();
      return;
    }
    mentionStart = at;
    mentionQuery = query;
    mentionOpen = true;
    if (files.length === 0) onRequestFiles();
  }

  async function selectMention(item: MentionItem): Promise<void> {
    const start = mentionStart;
    const task = activeDraft;
    const source = text;
    try {
      const resolved = await resolveMention(item);
      if (task === activeDraft && mentionOpen && source === text && start === mentionStart) editor?.insertMention(start, resolved);
      closeMention();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (savingEdit) { event.preventDefault(); return; }
    if (event.key === "Escape" && voice.active) {
      event.preventDefault();
      event.stopPropagation();
      voice.cancel();
      return;
    }
    if (event.key === "Escape" && editing) {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      return;
    }
    if (event.key === "Escape" && running) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) onStop();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.altKey) return;
    if (providers.length === 0) {
      event.preventDefault();
      return;
    }
    if (preferences.sendShortcut === "modifier-enter" && !isModifier(event)) {
      event.preventDefault();
      editor?.insertNewline();
      return;
    }
    event.preventDefault();
    form.requestSubmit();
  }
</script>

<footer class="composer-wrap" data-harness-region="composer" class:is-hero={layout === "hero"}>
  <div class="composer-stack">
    <QueueTray items={queued} onEdit={onQueueEdit} onRemove={onQueueRemove} />
  <form class="composer" class:is-dropping={dropActive} class:is-editing={Boolean(editing)} aria-busy={savingEdit} inert={savingEdit} bind:this={form} onsubmit={submit}>
    {#if editing}
      <div class="composer-edit-header"><span><Icon name="edit" size={14} />{t("Editing message")}</span><button class="composer-edit-cancel" type="button" disabled={savingEdit} onclick={cancelEdit}>{t("Cancel")}</button></div>
      {#if editError}<p class="composer-edit-error" role="alert">{t("Could not save this message. Your edit is still here. Try again.")}</p>{/if}
    {/if}
    {#if voice.active}
      <VoiceGlow stream={voice.stream} processing={voice.state === "processing"} />
    {/if}
    {#if dropActive}
      <span class="drop-hint">{t("Drop files to attach")}</span>
    {/if}
    {#if attachments.length > 0}
      <AttachmentStrip
        {attachments}
        disabled={savingEdit}
        onRemove={(id) => (attachments = attachments.filter((entry) => entry.id !== id))}
      />
    {/if}
    {#if mentionOpen}
      <MentionMenu
        items={mentionItems}
        query={mentionQuery}
        onSelect={selectMention}
        onClose={closeMention}
      />
    {/if}
    {#if slashOpen}
      <SlashMenu
        query={text}
        skills={commands}
        onSelect={selectSlash}
        onClose={() => (slashOpen = false)}
      />
    {/if}
    {#if voice.active}
      <span class="sr-only voice-status" role="status">{voice.status}</span>
    {/if}
    {#key draftTask}
      <PromptEditor
        bind:this={editor}
        bind:value={text}
        bind:mentions
        {placeholder}
        menu={mentionOpen ? "mention" : slashOpen ? "slash" : undefined}
        oninput={updateComposerHints}
        onkeydown={onKeydown}
        onpaste={(event) => void onPaste(event).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))}
        ondragover={onDragOver}
        ondragleave={() => (dropActive = false)}
        ondrop={(event) => void onDrop(event)}
      />
    {/key}
    <ComposerBar
      editing={Boolean(editing)}
      editPending={savingEdit}
      {running}
      {stopping}
      {canContinue}
      {controlCooldown}
      {onContinue}
      hasDraft={text.trim().length > 0 || attachments.length > 0}
      canSend={canSend && !voice.active && !savingEdit && (!editing || !editBlocked)}
      voiceSupported={voice.supported}
      voiceListening={voice.state === "listening"}
      voicePending={voice.state === "requesting" || voice.state === "processing"}
      voiceActive={voice.active}
      voiceStatus={voice.status}
      voiceProvider={voice.provider}
      onVoiceStart={() => voice.start()}
      onVoiceStop={() => voice.stop()}
      onVoiceCancel={() => voice.cancel()}
      {context}
      {onCompact}
      {providers}
      {provider}
      {model}
      {reasoning}
      {variant}
      onSend={(mode) => sendDraft(mode)}
      onAttach={() => void pickFiles()}
      {onModelSelect}
      {onReasoningChange}
      {onVariantChange}
      {onStop}
    />
  </form>
  </div>
</footer>
