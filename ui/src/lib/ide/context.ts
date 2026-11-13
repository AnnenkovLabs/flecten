import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { ContextReference, EditorContext } from "../composer/context-types";

const SYMBOLS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "MethodDeclaration",
  "VariableDeclaration",
  "InterfaceDeclaration",
  "TypeAliasDeclaration",
]);

export function editorContext(path: string, state: EditorState): EditorContext {
  const selection = state.selection.main;
  const make = (kind: "selection" | "symbol", from: number, to: number): ContextReference => {
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    return {
      kind,
      source: `${path}#L${first}-L${last}`,
      label: `${kind}:${path}:L${first}-L${last}`,
      text: state.sliceDoc(from, Math.min(to, from + 60_000)),
    };
  };
  const result: EditorContext = {};
  if (!selection.empty) result.selection = make("selection", selection.from, selection.to);
  let node = syntaxTree(state).resolveInner(selection.head, -1);
  for (;;) {
    if (SYMBOLS.has(node.name)) {
      result.symbol = make("symbol", node.from, node.to);
      break;
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return result;
}
