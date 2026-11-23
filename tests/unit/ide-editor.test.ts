import { expect, test } from "bun:test";
import { editorContextDetail } from "../../ui/src/lib/ide/context";
import {
  detectEol,
  editorLanguage,
  fileIcon,
  monacoEditorOptions,
} from "../../ui/src/lib/ide/editor";
import { FLECTEN_THEME, flectenDarkTheme } from "../../ui/src/lib/ide/editor-theme";
import {
  highlightSnippet,
  parseLineTarget,
  parseQuickQuery,
} from "../../ui/src/lib/ide/quick-search";

test("IDE resolves explicit Monaco languages, file icon tints, theme, and native editor options", () => {
  expect(editorLanguage("src/main.ts")).toEqual({ id: "typescript", label: "TypeScript" });
  expect(editorLanguage("src/Main.tsx")).toEqual({ id: "typescript", label: "TypeScript JSX" });
  expect(editorLanguage("README.MD")).toEqual({ id: "markdown", label: "Markdown" });
  expect(editorLanguage("Dockerfile")).toEqual({ id: "dockerfile", label: "Dockerfile" });
  expect(editorLanguage("script.py")).toEqual({ id: "python", label: "Python" });
  expect(editorLanguage("src/lib.rs")).toEqual({ id: "rust", label: "Rust" });
  expect(editorLanguage("unknown.config").id).toBe("plaintext");

  expect(fileIcon("src/main.ts").badge).toBe("TS");
  expect(fileIcon("ui/App.svelte").badge).toBe("SV");
  expect(detectEol("a\r\nb")).toBe("CRLF");
  expect(detectEol("a\nb")).toBe("LF");

  expect(FLECTEN_THEME).toBe("flecten-dark");
  expect(flectenDarkTheme.colors["editor.background"]).toBe("#171717");
  expect(flectenDarkTheme.rules.length).toBeGreaterThan(20);

  const normal = monacoEditorOptions(
    { wrap: false, tabSize: 2, fontSize: 13, minimap: true },
    false,
    false,
    true,
    "Editor src/main.ts",
  );
  expect(normal.cursorBlinking).toBe("smooth");
  expect(normal.cursorSmoothCaretAnimation).toBe("explicit");
  expect(normal.smoothScrolling).toBe(true);
  expect(normal.scrollBeyondLastLine).toBe(true);
  expect(normal.minimap?.enabled).toBe(true);
  expect(normal.quickSuggestions).toBe(false);

  const reduced = monacoEditorOptions(
    { wrap: true, tabSize: 4, fontSize: 15, minimap: false },
    true,
    true,
    true,
    "Editor src/main.ts",
  );
  expect(reduced.cursorBlinking).toBe("solid");
  expect(reduced.cursorSmoothCaretAnimation).toBe("off");
  expect(reduced.smoothScrolling).toBe(false);
  expect(reduced.minimap?.enabled).toBe(false);
  expect(reduced.wordWrap).toBe("on");
  expect(reduced.readOnly).toBe(true);

  const code = "export function greet(name: string) {\n  return 'hi ' + name;\n}\n";
  const start = code.indexOf("'hi '");
  const detail = editorContextDetail("src/main.ts", code, start, start + "'hi ' + name".length);
  expect(detail.symbolName).toBe("greet");
  expect(detail.context.symbol?.text).toContain("function greet");
  expect(detail.context.selection?.text).toBe("'hi ' + name");

  expect(parseQuickQuery("%needle", "files")).toEqual({ kind: "text", term: "needle" });
  expect(parseQuickQuery("  % const answer ", "files")).toEqual({
    kind: "text",
    term: "const answer",
  });
  expect(parseQuickQuery(">wrap", "files")).toEqual({ kind: "commands", term: "wrap" });
  expect(parseQuickQuery(":42:8", "files")).toEqual({ kind: "line", term: "42:8" });
  expect(parseQuickQuery("main.ts", "files")).toEqual({ kind: "files", term: "main.ts" });
  expect(parseLineTarget("42:8")).toEqual({ line: 42, column: 8 });
  expect(parseLineTarget("10")).toEqual({ line: 10, column: 1 });
  expect(parseLineTarget("0")).toBeNull();
  expect(highlightSnippet("  export const answer = 42; ", "answer")).toEqual({
    before: "export const ",
    match: "answer",
    after: " = 42;",
  });
});
