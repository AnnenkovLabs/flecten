<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { Editor } from "@tiptap/core";
  import { closeHistory } from "@tiptap/pm/history";
  import { Slice } from "@tiptap/pm/model";
  import { EditorState } from "@tiptap/pm/state";
  import { onMount } from "svelte";
  import type { MentionItem } from "../../lib/composer/types";
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
    onkeydown: (event: KeyboardEvent) => void;
    onpaste: (event: ClipboardEvent) => void;
    ondragover: (event: DragEvent) => void;
    ondragleave: () => void;
    ondrop: (event: DragEvent) => void;
  }
  let {
    value = $bindable(), mentions = $bindable(), placeholder, menu,
    oninput, onkeydown, onpaste, ondragover, ondragleave, ondrop,
  }: Props = $props();
  let host: HTMLDivElement;
  let editor = $state<Editor | null>(null);

  function publish(): void {
    if (!editor) return;
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
      onSelectionUpdate: () => oninput(),
    });
    return () => editor?.destroy();
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
</script>

<div class="prompt-host" bind:this={host}></div>
