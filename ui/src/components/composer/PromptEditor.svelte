<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { Editor } from "@tiptap/core";
  import { closeHistory } from "@tiptap/pm/history";
  import { Slice } from "@tiptap/pm/model";
  import { EditorState, TextSelection } from "@tiptap/pm/state";
  import { onMount } from "svelte";
  import type { MentionItem } from "../../lib/composer/types";
  import type { HistoryDirection } from "../../lib/composer/prompt-history";
  import { PromptRoller } from "../../lib/composer/prompt-roll";
  import { editorPosition, sourceOffset, promptContent, promptSnapshot, type MentionSpan } from "../../lib/composer/prompt-document";
  import { promptExtensions } from "../../lib/composer/prompt-schema";
  import { PROMPT_CLIPBOARD_TYPE, readPromptClipboard, selectionSnapshot } from "../../lib/composer/prompt-clipboard";
  import "./prompt-editor.css";

  interface Props {
    value: string;
    mentions: MentionSpan[];
    placeholder: string;
    menu?: "mention" | "slash" | undefined;
    oninput: () => void;
    onselection?: (() => void) | undefined;
    oninteract?: (() => void) | undefined;
    onkeydown: (event: KeyboardEvent) => void;
    onpaste: (event: ClipboardEvent) => void;
    ondragover: (event: DragEvent) => void;
    ondragleave: () => void;
    ondrop: (event: DragEvent) => void;
  }
  let {
    value = $bindable(), mentions = $bindable(), placeholder, menu,
    oninput, onselection, oninteract, onkeydown, onpaste, ondragover, ondragleave, ondrop,
  }: Props = $props();
  const uid = $props.id();
  const blurInId = `${uid}-prompt-blur-in`;
  const blurOutId = `${uid}-prompt-blur-out`;
  let stage: HTMLDivElement;
  let host: HTMLDivElement;
  let blurIn: SVGFEGaussianBlurElement;
  let blurOut: SVGFEGaussianBlurElement;
  let editor = $state<Editor | null>(null);
  let roller: PromptRoller | null = null;

  function publish(): void {
    if (!editor) return;
    roller?.cancel();
    const snapshot = promptSnapshot(editor.state.doc);
    value = snapshot.text;
    mentions = snapshot.mentions;
    oninput();
  }

  function copySelection(event: ClipboardEvent, cut = false): boolean {
    if (!editor || !event.clipboardData || editor.state.selection.empty) return false;
    const snapshot = promptSnapshot(editor.state.doc);
    const selection = editor.state.selection;
    const copied = selectionSnapshot(snapshot,
      sourceOffset(selection.from, snapshot.mentions), sourceOffset(selection.to, snapshot.mentions));
    event.clipboardData.setData("text/plain", copied.text);
    event.clipboardData.setData(PROMPT_CLIPBOARD_TYPE, JSON.stringify(copied));
    event.preventDefault();
    if (cut) editor.commands.deleteSelection();
    return true;
  }

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: promptExtensions,
      content: promptContent(value, mentions),
      enableInputRules: false,
      enablePasteRules: false,
      editorProps: {
        attributes: {
          id: "prompt", class: "prompt-editor", role: "textbox",
          "aria-label": t("Message the agent"), "aria-multiline": "true",
        },
        handleDOMEvents: {
          copy: (_view, event) => copySelection(event),
          cut: (_view, event) => copySelection(event, true),
          pointerdown: () => { oninteract?.(); return false; },
          keydown: (_view, event) => { onkeydown(event); return event.defaultPrevented; },
          paste: (_view, event) => {
            if (!event.clipboardData) return false;
            if (event.clipboardData.files.length || [...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) {
              onpaste(event);
              return event.defaultPrevented;
            }
            const view = editor?.view;
            if (!view) return false;
            const text = event.clipboardData.getData("text/plain");
            const saved = readPromptClipboard(event.clipboardData.getData(PROMPT_CLIPBOARD_TYPE), text);
            event.preventDefault();
            if (saved) {
              const doc = view.state.schema.nodeFromJSON(promptContent(saved.text, saved.mentions));
              if (doc.firstChild) view.dispatch(view.state.tr.replaceSelection(new Slice(doc.firstChild.content, 0, 0)));
            } else view.dispatch(view.state.tr.insertText(text));
            return true;
          },
          dragover: (_view, event) => { ondragover(event); return event.defaultPrevented; },
          dragleave: () => { ondragleave(); return false; },
          drop: (_view, event) => { ondrop(event); return event.defaultPrevented; },
        },
        clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, "\n", (node) =>
          node.type.name === "mention" ? `@${String(node.attrs.path)}` : ""),
      },
      onUpdate: publish,
      onSelectionUpdate: () => (onselection ? onselection() : oninput()),
    });
    roller = new PromptRoller({
      stage,
      host,
      editor: () => editor?.view.dom ?? null,
      blurIn: () => blurIn ?? null,
      blurOut: () => blurOut ?? null,
      blurInId,
      blurOutId,
    });
    return () => {
      roller?.cancel();
      roller = null;
      editor?.destroy();
    };
  });

  $effect(() => {
    if (!editor) return;
    const snapshot = promptSnapshot(editor.state.doc);
    if (snapshot.text !== value || JSON.stringify(snapshot.mentions) !== JSON.stringify(mentions)) {
      // A controlled replacement starts a new draft. Undo must not resurrect a sent message.
      const { schema, plugins } = editor.state;
      editor.view.updateState(EditorState.create({
        schema, plugins, doc: schema.nodeFromJSON(promptContent(value, mentions)),
      }));
    }
    editor.view.dom.dataset.placeholder = placeholder;
    editor.view.dom.dataset.empty = String(value.length === 0);
    editor.view.dom.setAttribute("aria-expanded", String(Boolean(menu)));
    if (menu) editor.view.dom.setAttribute("aria-controls", `${menu}-menu`);
    else editor.view.dom.removeAttribute("aria-controls");
  });

  export function insertNewline(): void {
    editor?.commands.insertContent({ type: "text", text: "\n" });
  }

  export function focus(): void { editor?.commands.focus(); }
  export function caret(): number {
    return editor ? sourceOffset(editor.state.selection.from, promptSnapshot(editor.state.doc).mentions) : value.length;
  }
  export function hasFocus(): boolean { return editor?.isFocused ?? false; }
  export function setSelectionRange(start: number, end: number): void {
    if (!editor) return;
    editor.commands.setTextSelection({ from: editorPosition(start, mentions), to: editorPosition(end, mentions) });
  }
  export function insertMention(start: number, item: MentionItem): void {
    if (!editor) return;
    const selection = editor.state.selection;
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.chain().focus().insertContentAt({ from: editorPosition(start, mentions), to: selection.to }, [
      { type: "mention", attrs: { path: item.path, kind: item.kind, context: item.context, label: item.label } },
      { type: "text", text: " " },
    ]).run();
    editor.view.dispatch(closeHistory(editor.state.tr));
  }

  export function insertImages(items: MentionItem[]): void {
    if (!editor || !items.length) return;
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.chain().focus().insertContent(items.flatMap((item) => [
      { type: "mention", attrs: { path: item.path, kind: "image", label: item.label } },
      { type: "text", text: " " },
    ])).run();
    editor.view.dispatch(closeHistory(editor.state.tr));
  }

  /** Dictation replaces only the changed text range, keeping neighboring atoms and undo history. */
  export function applyText(next: string, nextCaret: number): void {
    if (!editor) return;
    let start = 0;
    let suffix = 0;
    while (start < value.length && start < next.length && value[start] === next[start]) start += 1;
    while (suffix < value.length - start && suffix < next.length - start && value.at(-suffix - 1) === next.at(-suffix - 1)) suffix += 1;
    const from = editorPosition(start, mentions);
    const to = editorPosition(value.length - suffix, mentions);
    editor.view.dispatch(editor.state.tr.insertText(next.slice(start, next.length - suffix), from, to));
    setSelectionRange(nextCaret, nextCaret);
  }

  export function isAtBoundary(direction: HistoryDirection): boolean {
    if (!editor) return false;
    const { selection, doc } = editor.state;
    if (!selection.empty) return false;
    if (value.length === 0) return true;
    const startPos = 1;
    const endPos = Math.max(1, doc.content.size - 1);
    if (direction === "up" && selection.from <= startPos) return true;
    if (direction === "down" && selection.to >= endPos) return true;
    try {
      const caretCoords = editor.view.coordsAtPos(selection.from);
      const edgeCoords = editor.view.coordsAtPos(direction === "up" ? startPos : endPos);
      if (caretCoords.bottom > caretCoords.top && edgeCoords.bottom > edgeCoords.top) {
        return direction === "up"
          ? Math.abs(caretCoords.top - edgeCoords.top) < 4
          : Math.abs(caretCoords.bottom - edgeCoords.bottom) < 4;
      }
    } catch {
      // Fall back to logical newline boundaries when layout coordinates are unavailable.
    }
    const offset = sourceOffset(selection.from, mentions);
    return direction === "up"
      ? value.lastIndexOf("\n", Math.max(0, offset - 1)) === -1
      : value.indexOf("\n", offset) === -1;
  }

  export function replaceWithRoll(
    nextText: string,
    nextMentions: MentionSpan[],
    direction: HistoryDirection,
  ): void {
    if (!editor) {
      value = nextText;
      mentions = nextMentions;
      return;
    }
    const snapshot = roller?.prepareSnapshot() ?? null;
    value = nextText;
    mentions = nextMentions;
    const { schema, plugins } = editor.state;
    const doc = schema.nodeFromJSON(promptContent(nextText, nextMentions));
    editor.view.updateState(
      EditorState.create({ schema, plugins, doc, selection: TextSelection.atEnd(doc) }),
    );
    editor.view.dom.dataset.empty = String(nextText.length === 0);
    editor.view.dom.scrollTop = editor.view.dom.scrollHeight;
    roller?.play(direction, snapshot);
  }

  export function cancelRoll(): void {
    roller?.cancel();
  }
</script>

<div class="prompt-stage" bind:this={stage}>
  <svg class="prompt-motion-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <filter id={blurInId} x="-10%" y="-90%" width="120%" height="280%" color-interpolation-filters="sRGB">
        <feGaussianBlur bind:this={blurIn} in="SourceGraphic" stdDeviation="0 0" />
      </filter>
      <filter id={blurOutId} x="-10%" y="-90%" width="120%" height="280%" color-interpolation-filters="sRGB">
        <feGaussianBlur bind:this={blurOut} in="SourceGraphic" stdDeviation="0 0" />
      </filter>
    </defs>
  </svg>
  <div class="prompt-host" bind:this={host}></div>
</div>
