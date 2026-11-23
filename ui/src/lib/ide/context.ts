import { parser } from "@lezer/javascript";
import type { ContextReference, EditorContext } from "../composer/context-types";

const SYMBOLS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "MethodDeclaration",
  "VariableDeclaration",
  "InterfaceDeclaration",
  "TypeAliasDeclaration",
]);

const NAME_NODES = new Set(["VariableDefinition", "PropertyDefinition", "TypeDefinition"]);

const PARSABLE = new Set(["ts", "mts", "cts", "tsx", "js", "mjs", "cjs", "jsx"]);

const tsJsxParser = parser.configure({ dialect: "ts jsx" });

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(text.length, offset));
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function canParseJsTs(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return PARSABLE.has(path.slice(dot + 1).toLowerCase());
}

function symbolNameFromNode(
  text: string,
  node: ReturnType<ReturnType<typeof tsJsxParser.parse>["resolveInner"]>,
): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (NAME_NODES.has(child.name)) return text.slice(child.from, child.to);
    if (child.name === "VariableDeclaration") {
      const inner = symbolNameFromNode(text, child);
      if (inner) return inner;
    }
  }
  return null;
}

export interface EditorContextDetail {
  context: EditorContext;
  symbolName: string | null;
}

export function editorContextDetail(
  path: string,
  text: string,
  anchor: number,
  head: number,
): EditorContextDetail {
  const from = Math.max(0, Math.min(text.length, Math.min(anchor, head)));
  const to = Math.max(0, Math.min(text.length, Math.max(anchor, head)));
  const make = (kind: "selection" | "symbol", start: number, end: number): ContextReference => {
    const first = lineNumberAt(text, start);
    const last = lineNumberAt(text, end);
    return {
      kind,
      source: `${path}#L${first}-L${last}`,
      label: `${kind}:${path}:L${first}-L${last}`,
      text: text.slice(start, Math.min(end, start + 60_000)),
    };
  };
  const context: EditorContext = {};
  if (to > from) context.selection = make("selection", from, to);

  let symbolName: string | null = null;
  if (canParseJsTs(path) && text.length <= 250_000) {
    const tree = tsJsxParser.parse(text);
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
      Math.max(0, Math.min(text.length, head)),
      -1,
    );
    while (node) {
      if (SYMBOLS.has(node.name)) {
        context.symbol = make("symbol", node.from, node.to);
        symbolName = symbolNameFromNode(text, node);
        break;
      }
      node = node.parent;
    }
  }
  return { context, symbolName };
}

export function editorContext(
  path: string,
  text: string,
  anchor: number,
  head: number,
): EditorContext {
  return editorContextDetail(path, text, anchor, head).context;
}
