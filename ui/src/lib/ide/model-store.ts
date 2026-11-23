import type { editor as MonacoEditor } from "monaco-editor";
import { editorLanguage } from "./editor";
import { initMonaco } from "./monaco";

const models = new Map<string, MonacoEditor.ITextModel>();

function modelUri(path: string): ReturnType<ReturnType<typeof initMonaco>["Uri"]["parse"]> {
  const monaco = initMonaco();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return monaco.Uri.from({ scheme: "flecten", authority: "workspace", path: normalized });
}

/**
 * Shared Monaco text model pool keyed by workspace-relative path.
 * Sharing models across tabs and split editors preserves native undo stacks
 * and keeps split panes synchronized live just like VS Code.
 */
export function acquireModel(path: string, text: string, tabSize: number): MonacoEditor.ITextModel {
  const monaco = initMonaco();
  const existing = models.get(path);
  if (existing && !existing.isDisposed()) {
    existing.updateOptions({ tabSize, insertSpaces: true });
    return existing;
  }
  const uri = modelUri(path);
  const previous = monaco.editor.getModel(uri);
  if (previous && !previous.isDisposed()) previous.dispose();
  const languageId = editorLanguage(path).id;
  const model = monaco.editor.createModel(text, languageId, uri);
  model.setEOL(
    text.includes("\r\n")
      ? monaco.editor.EndOfLineSequence.CRLF
      : monaco.editor.EndOfLineSequence.LF,
  );
  model.updateOptions({ tabSize, insertSpaces: true });
  models.set(path, model);
  return model;
}

/** Apply an external disk reload without pushing a spurious user edit onto the undo stack. */
export function syncModelText(model: MonacoEditor.ITextModel, text: string): void {
  if (model.getValue() === text) return;
  const monaco = initMonaco();
  model.setEOL(
    text.includes("\r\n")
      ? monaco.editor.EndOfLineSequence.CRLF
      : monaco.editor.EndOfLineSequence.LF,
  );
  model.setValue(text);
}

/** Dispose models whose tabs were closed so undo buffers do not leak memory. */
export function releaseClosedModels(openPaths: readonly string[]): void {
  const keep = new Set(openPaths);
  for (const [path, model] of models) {
    if (keep.has(path)) continue;
    models.delete(path);
    if (!model.isDisposed()) model.dispose();
  }
}

export function updateModelTabSize(tabSize: number): void {
  for (const model of models.values()) {
    if (!model.isDisposed()) model.updateOptions({ tabSize, insertSpaces: true });
  }
}
