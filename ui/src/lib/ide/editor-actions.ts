import type { editor as MonacoEditor } from "monaco-editor";

export type EditorAction =
  | "undo"
  | "redo"
  | "find"
  | "replace"
  | "select-all"
  | "comment"
  | "duplicate-line"
  | "delete-line"
  | "move-up"
  | "move-down"
  | "indent"
  | "outdent"
  | "fold-all"
  | "unfold-all"
  | "next-match"
  | "focus";

const MONACO_ACTION: Partial<Record<EditorAction, string>> = {
  find: "actions.find",
  replace: "editor.action.startFindReplaceAction",
  comment: "editor.action.commentLine",
  "duplicate-line": "editor.action.copyLinesDownAction",
  "delete-line": "editor.action.deleteLines",
  "move-up": "editor.action.moveLinesUpAction",
  "move-down": "editor.action.moveLinesDownAction",
  indent: "editor.action.indentLines",
  outdent: "editor.action.outdentLines",
  "fold-all": "editor.foldAll",
  "unfold-all": "editor.unfoldAll",
  "next-match": "editor.action.addSelectionToNextFindMatch",
};

export function editorAction(
  editor: MonacoEditor.IStandaloneCodeEditor,
  action: EditorAction,
): void {
  if (action === "focus") {
    editor.focus();
    return;
  }
  if (action === "undo" || action === "redo") {
    editor.trigger("ide", action, null);
    editor.focus();
    return;
  }
  if (action === "select-all") {
    const model = editor.getModel();
    if (model) editor.setSelection(model.getFullModelRange());
    editor.focus();
    return;
  }
  const id = MONACO_ACTION[action];
  if (id) void editor.getAction(id)?.run();
  if (action !== "find" && action !== "replace") editor.focus();
}
