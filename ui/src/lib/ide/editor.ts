import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { openSearchPanel, search } from "@codemirror/search";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { t } from "../i18n.svelte";

/** Filename extensions select a parser explicitly; unknown formats remain plain text. */
export function editorLanguage(path: string): { label: string; extension: Extension } {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const suffix = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (suffix) {
    case "ts":
    case "mts":
    case "cts":
      return { label: "TypeScript", extension: javascript({ typescript: true }) };
    case "tsx":
      return { label: "TypeScript JSX", extension: javascript({ typescript: true, jsx: true }) };
    case "js":
    case "mjs":
    case "cjs":
      return { label: "JavaScript", extension: javascript() };
    case "jsx":
      return { label: "JavaScript JSX", extension: javascript({ jsx: true }) };
    case "json":
      return { label: "JSON", extension: json() };
    case "css":
      return { label: "CSS", extension: css() };
    case "html":
    case "htm":
      return { label: "HTML", extension: html() };
    case "md":
    case "markdown":
      return { label: "Markdown", extension: markdown() };
    default:
      return { label: t("Text"), extension: [] };
  }
}

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.definitionKeyword],
    color: "var(--text)",
    fontWeight: "600",
  },
  { tag: [tags.string, tags.attributeValue], color: "var(--text-2)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--text)" },
  { tag: [tags.tagName, tags.typeName, tags.className], color: "var(--text)", fontWeight: "600" },
  { tag: [tags.heading, tags.strong], color: "var(--text)", fontWeight: "600" },
  { tag: tags.link, textDecoration: "underline" },
]);

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--bg)",
      color: "var(--text-body)",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: "1px solid var(--primary)", outlineOffset: "-1px" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--mono)", lineHeight: "1.65" },
    ".cm-content": { padding: "8px 0 48px", caretColor: "var(--text)", minHeight: "100%" },
    ".cm-line": { padding: "0 20px 0 12px" },
    ".cm-gutters": { backgroundColor: "var(--bg)", border: "none", color: "var(--muted)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "48px" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--raised-hover)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
    ".cm-cursorLayer": { animation: "none" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--raised)",
      border: "none",
      color: "var(--text-2)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--line-strong)",
      backgroundColor: "var(--raised)",
      color: "var(--text)",
    },
    ".cm-panels": {
      backgroundColor: "var(--surface)",
      color: "var(--text-2)",
      fontFamily: "var(--font)",
    },
    ".cm-panels-top": { borderBottom: "1px solid var(--line)" },
    ".cm-search": {
      padding: "8px 12px",
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      alignItems: "center",
    },
    ".cm-textfield": {
      backgroundColor: "var(--bg)",
      color: "var(--text)",
      border: "1px solid var(--line-strong)",
      borderRadius: "4px",
      padding: "4px 6px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--raised)",
      color: "var(--text)",
      border: "1px solid var(--line-strong)",
      borderRadius: "4px",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--raised-hover)",
      outline: "1px solid var(--muted)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--raised-hover)",
      outline: "1px solid var(--primary)",
    },
  },
  { dark: true },
);

export function editorExtensions(path: string, onSave: () => void): Extension[] {
  return [
    basicSetup,
    Prec.lowest(EditorState.tabSize.of(2)),
    editorLanguage(path).extension,
    theme,
    syntaxHighlighting(highlight),
    search({ top: true }),

    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSave();
          return true;
        },
      },
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
      { key: "Alt-Shift-ArrowUp", run: copyLineUp },
      { key: "Alt-Shift-ArrowDown", run: copyLineDown },
      { key: "Mod-Shift-k", run: deleteLine },
      { key: "Mod-/", run: toggleComment },
      { key: "Mod-h", run: openSearchPanel },
      indentWithTab,
    ]),
  ];
}

export function editorPhrases(): Record<string, string> {
  return {
    Find: t("Find"),
    Replace: t("Replace"),
    next: t("Next"),
    previous: t("Previous"),
    all: t("All"),
    "match case": t("Match case"),
    regexp: t("Regular expression"),
    "by word": t("Whole word"),
    replace: t("Replace"),
    "replace all": t("Replace all"),
    close: t("Close"),
    "Go to line": t("Go to line"),
    go: t("Go"),
    "current match": t("Current match"),
    "on line": t("on line"),
    "replaced match on line $": t("Replaced match on line $"),
    "replaced $ matches": t("Matches replaced: $"),
  };
}
