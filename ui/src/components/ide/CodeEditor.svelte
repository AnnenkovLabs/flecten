<script lang="ts">
  import type { editor as MonacoEditor } from "monaco-editor";
  import { onMount, untrack } from "svelte";
  import type { EditorContext } from "../../lib/composer/context-types";
  import { i18n, t } from "../../lib/i18n.svelte";
  import { editorContextDetail } from "../../lib/ide/context";
  import { type EditorPreferences, monacoEditorOptions } from "../../lib/ide/editor";
  import { type EditorAction, editorAction } from "../../lib/ide/editor-actions";
  import {
    acquireModel,
    releaseClosedModels,
    syncModelText,
    updateModelTabSize,
  } from "../../lib/ide/model-store";
  import { initMonaco } from "../../lib/ide/monaco";
  import "./monaco.css";

  export interface CursorDetail {
    selectedChars: number;
    selectedLines: number;
    cursors: number;
    symbolName: string | null;
  }

  interface Props {
    path: string;
    value: string;
    openPaths: string[];
    loading?: boolean;
    readOnly?: boolean;
    preferences?: EditorPreferences;
    action?: { name: EditorAction; token: number } | null;
    location?: { path: string; line: number; column: number; length: number; token: number } | null;
    onChange: (text: string) => void;
    onSave: () => void;
    onCursor?: (line: number, column: number, detail?: CursorDetail) => void;
    onContext?: (context: EditorContext) => void;
    onSymbol?: (name: string | null) => void;
  }

  let {
    path,
    value,
    openPaths,
    loading = false,
    readOnly = false,
    onChange,
    onSave,
    onCursor,
    onContext,
    onSymbol,
    preferences = { wrap: false, tabSize: 2, fontSize: 13, minimap: true },
    action = null,
    location = null,
  }: Props = $props();

  let host: HTMLDivElement;
  let editor = $state.raw<MonacoEditor.IStandaloneCodeEditor | null>(null);
  let wideEnough = $state(true);
  let reducedMotion = $state(false);
  const viewStates = new Map<string, MonacoEditor.ICodeEditorViewState>();
  let currentPath = "";
  let syncing = false;
  let lastLocation = 0;

  function reportCursor(instance: MonacoEditor.IStandaloneCodeEditor, force = false): void {
    if (!force && !instance.hasTextFocus()) return;
    const model = instance.getModel();
    const primary = instance.getSelection();
    if (!model || !primary) return;
    const selections = instance.getSelections() ?? [primary];
    let selectedChars = 0;
    for (const sel of selections) {
      if (!sel.isEmpty()) selectedChars += model.getValueLengthInRange(sel);
    }
    const selectedLines = primary.isEmpty() ? 0 : primary.endLineNumber - primary.startLineNumber + 1;
    const anchorOffset = model.getOffsetAt(primary.getStartPosition());
    const headOffset = model.getOffsetAt(primary.getEndPosition());
    const cursorOffset = model.getOffsetAt(primary.getPosition());
    const detail = editorContextDetail(
      currentPath,
      model.getValue(),
      primary.isEmpty() ? cursorOffset : anchorOffset,
      primary.isEmpty() ? cursorOffset : headOffset,
    );
    onCursor?.(primary.positionLineNumber, primary.positionColumn, {
      selectedChars,
      selectedLines,
      cursors: selections.length,
      symbolName: detail.symbolName,
    });
    onSymbol?.(detail.symbolName);
    onContext?.(detail.context);
  }

  function applyOptions(
    instance: MonacoEditor.IStandaloneCodeEditor,
    prefs: EditorPreferences,
    locked: boolean,
    motionReduced: boolean,
    minimapRoom: boolean,
    filePath: string,
  ): void {
    const opts = monacoEditorOptions(
      prefs,
      locked,
      motionReduced,
      minimapRoom,
      t("Editor {0}", [filePath]),
    );
    instance.updateOptions(opts);
  }

  onMount(() => {
    const monaco = initMonaco();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = motionQuery.matches;
    wideEnough = host.clientWidth >= 560;

    const instance = monaco.editor.create(
      host,
      {
        ...monacoEditorOptions(
          preferences,
          readOnly,
          reducedMotion,
          wideEnough,
          t("Editor {0}", [path]),
        ),
        model: null,
      },
    );
    if (!loading) {
      currentPath = path;
      instance.setModel(acquireModel(path, value, preferences.tabSize));
    }
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    const contentSub = instance.onDidChangeModelContent(() => {
      const activeModel = instance.getModel();
      if (!syncing && activeModel) onChange(activeModel.getValue());
      reportCursor(instance);
    });
    const cursorSub = instance.onDidChangeCursorSelection(() => {
      reportCursor(instance);
    });
    const focusSub = instance.onDidFocusEditorText(() => {
      reportCursor(instance, true);
    });

    const onMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches;
    };
    motionQuery.addEventListener("change", onMotionChange);

    const observer = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      const nextWide = host.clientWidth >= 560;
      if (nextWide !== wideEnough) wideEnough = nextWide;
      instance.layout();
    });
    observer.observe(host);

    editor = instance;
    instance.layout();
    instance.focus();
    reportCursor(instance, true);

    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      observer.disconnect();
      contentSub.dispose();
      cursorSub.dispose();
      focusSub.dispose();
      instance.setModel(null);
      instance.dispose();
    };
  });

  $effect(() => {
    const instance = editor;
    const filePath = path;
    const text = value;
    const isLoading = loading;
    const paths = openPaths;
    const tabSize = preferences.tabSize;
    if (!instance) return;
    untrack(() => {
      syncing = true;
      for (const cached of viewStates.keys()) {
        if (!paths.includes(cached)) viewStates.delete(cached);
      }
      if (isLoading) {
        if (currentPath && paths.includes(currentPath)) {
          const saved = instance.saveViewState();
          if (saved) viewStates.set(currentPath, saved);
        }
        syncing = false;
        return;
      }
      if (filePath !== currentPath) {
        if (currentPath && paths.includes(currentPath)) {
          const saved = instance.saveViewState();
          if (saved) viewStates.set(currentPath, saved);
        }
        currentPath = filePath;
        const model = acquireModel(filePath, text, tabSize);
        instance.setModel(model);
        const restored = viewStates.get(filePath);
        if (restored) {
          instance.restoreViewState(restored);
        } else {
          instance.setPosition({ lineNumber: 1, column: 1 });
          instance.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        }
        instance.layout();
        instance.focus();
      } else {
        instance.layout();
      }
      releaseClosedModels(paths);
      const activeModel = instance.getModel();
      if (activeModel && activeModel.getValue() !== text) {
        syncModelText(activeModel, text);
      }
      syncing = false;
      reportCursor(instance, true);
    });
  });

  $effect(() => {
    const instance = editor;
    const prefs = preferences;
    const locked = readOnly;
    const motionReduced = reducedMotion;
    const minimapRoom = wideEnough;
    const locale = i18n.locale;
    const filePath = path;
    if (!instance || !locale) return;
    untrack(() => {
      updateModelTabSize(prefs.tabSize);
      applyOptions(instance, prefs, locked, motionReduced, minimapRoom, filePath);
    });
  });

  $effect(() => {
    const request = action;
    if (editor && request) untrack(() => editorAction(editor!, request.name));
  });

  $effect(() => {
    const target = location;
    const instance = editor;
    if (!instance || !target || target.token === lastLocation || target.path !== path) return;
    const model = instance.getModel();
    if (!model || value !== model.getValue()) return;
    lastLocation = target.token;
    untrack(() => {
      const lineNumber = Math.max(1, Math.min(model.getLineCount(), target.line));
      const maxCol = model.getLineMaxColumn(lineNumber);
      const startColumn = Math.max(1, Math.min(maxCol, target.column));
      const endColumn = Math.min(maxCol, startColumn + Math.max(0, target.length));
      instance.setSelection({
        startLineNumber: lineNumber,
        startColumn,
        endLineNumber: lineNumber,
        endColumn,
      });
      instance.revealPositionInCenterIfOutsideViewport({ lineNumber, column: startColumn });
      instance.focus();
      reportCursor(instance, true);
    });
  });
</script>

<div class="code-editor" bind:this={host}></div>

<style>
  .code-editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }
</style>
