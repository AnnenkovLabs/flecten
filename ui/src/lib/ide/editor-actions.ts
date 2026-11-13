import {
  copyLineDown,
  deleteLine,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  redo,
  selectAll,
  toggleComment,
  undo,
} from "@codemirror/commands";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";

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
export function editorAction(view: EditorView, action: EditorAction): void {
  const commands = {
    undo,
    redo,
    find: openSearchPanel,
    replace: openSearchPanel,
    "select-all": selectAll,
    comment: toggleComment,
    "duplicate-line": copyLineDown,
    "delete-line": deleteLine,
    "move-up": moveLineUp,
    "move-down": moveLineDown,
    indent: indentMore,
    outdent: indentLess,
    "fold-all": foldAll,
    "unfold-all": unfoldAll,
    "next-match": selectNextOccurrence,
    focus: () => true,
  };
  commands[action](view);
  if (action !== "find" && action !== "replace") view.focus();
}
