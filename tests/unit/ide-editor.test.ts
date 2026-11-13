import { expect, test } from "bun:test";
import { undo, undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { editorExtensions, editorLanguage } from "../../ui/src/lib/ide/editor";

test("IDE uses explicit filename parsers and retains native undo history", () => {
  expect(editorLanguage("src/main.ts").label).toBe("TypeScript");
  expect(editorLanguage("src/Main.tsx").label).toBe("TypeScript JSX");
  expect(editorLanguage("README.MD").label).toBe("Markdown");
  expect(editorLanguage("unknown.config").label).toBe("Текст");

  let state = EditorState.create({
    doc: "const answer: number = 42;",
    extensions: editorExtensions("src/main.ts", () => undefined),
  });
  expect(ensureSyntaxTree(state, state.doc.length)?.toString()).toContain("TypeAnnotation");
  state = state.update({ changes: { from: state.doc.length, insert: "\nanswer;" } }).state;
  expect(state.doc.lines).toBe(2);
  expect(state.tabSize).toBe(2);
  expect(undoDepth(state)).toBe(1);
  expect(
    undo({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    }),
  ).toBe(true);
  expect(state.doc.toString()).toBe("const answer: number = 42;");
});
