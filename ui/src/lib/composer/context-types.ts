export type ContextKind = "selection" | "symbol" | "task" | "pull-request" | "mcp-resource";
export interface ContextReference {
  kind: ContextKind;
  source: string;
  label: string;
  text: string;
}
export interface EditorContext {
  selection?: ContextReference;
  symbol?: ContextReference;
}
