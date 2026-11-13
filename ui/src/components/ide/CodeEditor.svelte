<script lang="ts">
  import { i18n, t } from "../../lib/i18n.svelte";
  import { Compartment, EditorState, Transaction } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { onMount, untrack } from "svelte";
  import { editorAction, type EditorAction } from "../../lib/ide/editor-actions";
  import { editorExtensions, editorPhrases } from "../../lib/ide/editor";
  import { editorContext } from "../../lib/ide/context";
  import type { EditorContext } from "../../lib/composer/context-types";

  interface Props {
    path: string;
    value: string;
    openPaths: string[];
    readOnly?: boolean;
    preferences?: { wrap: boolean; tabSize: number; fontSize: number };
    action?: { name: EditorAction; token: number } | null;
    location?: { path: string; line: number; column: number; length: number; token: number } | null;
    onChange: (text: string) => void;
    onSave: () => void;
    onCursor?: (line: number, column: number) => void;
    onContext?: (context: EditorContext) => void;
  }

  let { path, value, openPaths, readOnly = false, onChange, onSave, onCursor, onContext, preferences = { wrap: false, tabSize: 2, fontSize: 13 }, action = null, location = null }: Props = $props();
  let host: HTMLDivElement;
  let view = $state.raw<EditorView | null>(null);
  const states = new Map<string, EditorState>();
  const positions = new Map<string, { top: number; left: number }>();
  const editable = new Compartment();
  const language = new Compartment();
  const options = new Compartment();
  let currentPath = "";
  let currentReadOnly = false;
  let syncing = false;
  let lastLocation = 0;

  function reportCursor(editor: EditorView): void {
    if (!editor.hasFocus) return;
    const cursor = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(cursor);
    onCursor?.(line.number, cursor - line.from + 1);
    onContext?.(editorContext(currentPath, editor.state));
  }

  function stateFor(filePath: string, text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        ...editorExtensions(filePath, () => onSave()),
        EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"),
        options.of([EditorState.tabSize.of(preferences.tabSize), ...(preferences.wrap ? [EditorView.lineWrapping] : []), EditorView.theme({ "&": { fontSize: `${preferences.fontSize}px` } })]),
        editable.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        language.of([EditorState.phrases.of(editorPhrases()), EditorView.contentAttributes.of({ "aria-label": t("Editor {0}", [filePath]), spellcheck: "false" })]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) onChange(update.state.sliceDoc());
          if (update.docChanged || update.selectionSet) reportCursor(update.view);
        }),
        EditorView.domEventHandlers({ focus: (_event, editor) => { reportCursor(editor); } }),
      ],
    });
  }

  onMount(() => {
    currentPath = path;
    currentReadOnly = readOnly;
    view = new EditorView({ state: stateFor(path, value), parent: host });
    view.focus();
    reportCursor(view);
    return () => { view?.destroy(); };
  });

  $effect(() => {
    const editor = view;
    const filePath = path;
    const text = value;
    const locked = readOnly;
    const paths = openPaths;
    if (!editor) return;
    untrack(() => {
      syncing = true;
      for (const cached of states.keys()) {
        if (!paths.includes(cached)) { states.delete(cached); positions.delete(cached); }
      }
      if (filePath !== currentPath) {
        if (paths.includes(currentPath)) {
          states.set(currentPath, editor.state);
          positions.set(currentPath, { top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft });
        }
        currentPath = filePath;
        editor.setState(states.get(filePath) ?? stateFor(filePath, text));
        const position = positions.get(filePath);
        editor.scrollDOM.scrollTop = position?.top ?? 0;
        editor.scrollDOM.scrollLeft = position?.left ?? 0;
        currentReadOnly = editor.state.facet(EditorState.readOnly);
        editor.focus();
      }
      if (editor.state.sliceDoc() !== text) {
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
          annotations: Transaction.addToHistory.of(false),
        });
      }
      if (locked !== currentReadOnly) {
        currentReadOnly = locked;
        editor.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) });
      }
      syncing = false;
      reportCursor(editor);
    });
  });
  $effect(() => {
    const editor = view;
    const settings = preferences;
    if (editor) editor.dispatch({ effects: options.reconfigure([EditorState.tabSize.of(settings.tabSize), ...(settings.wrap ? [EditorView.lineWrapping] : []), EditorView.theme({ "&": { fontSize: `${settings.fontSize}px` } })]) });
  });
  $effect(() => {
    const locale = i18n.locale;
    const editor = view;
    const filePath = path;
    if (editor && locale) untrack(() => editor.dispatch({ effects: language.reconfigure([
      EditorState.phrases.of(editorPhrases()),
      EditorView.contentAttributes.of({ "aria-label": t("Editor {0}", [filePath]), spellcheck: "false" }),
    ]) }));
  });
  $effect(() => {
    const request = action;
    if (view && request) untrack(() => editorAction(view!, request.name));
  });
  $effect(() => {
    const target = location;
    const editor = view;
    if (!editor || !target || target.token === lastLocation || target.path !== path || value !== editor.state.sliceDoc()) return;
    lastLocation = target.token;
    untrack(() => {
      const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, target.line)));
      const anchor = Math.min(line.to, line.from + Math.max(0, target.column - 1));
      editor.dispatch({ selection: { anchor, head: Math.min(line.to, anchor + target.length) }, scrollIntoView: true });
      editor.focus();
    });
  });
</script>

<div class="code-editor" bind:this={host}></div>

<style>
  .code-editor { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
  .code-editor :global(*) { transition: none !important; animation: none !important; }
</style>
