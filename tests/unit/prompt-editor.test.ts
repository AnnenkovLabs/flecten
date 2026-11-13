import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { readPromptClipboard, selectionSnapshot } from "../../ui/src/lib/composer/prompt-clipboard";
import {
  editorPosition,
  type MentionSpan,
  promptContent,
  promptSnapshot,
  sourceOffset,
} from "../../ui/src/lib/composer/prompt-document";
import { promptExtensions } from "../../ui/src/lib/composer/prompt-schema";
import { popoverPlacement } from "../../ui/src/lib/popover";

describe("composer document", () => {
  it("copies selected atoms and validates structured clipboard data before restoring them", () => {
    const snapshot = {
      text: "See @src/a.ts now",
      mentions: [{ start: 4, end: 13, path: "src/a.ts", kind: "file" as const }],
    };
    const selected = selectionSnapshot(snapshot, 4, 13);
    expect(selected).toEqual({
      text: "@src/a.ts",
      mentions: [{ start: 0, end: 9, path: "src/a.ts", kind: "file" }],
    });
    expect(readPromptClipboard(JSON.stringify(selected), selected.text)).toEqual(selected);
    expect(readPromptClipboard(JSON.stringify(selected), "different text")).toBeNull();
    expect(
      readPromptClipboard(
        JSON.stringify({ ...selected, mentions: [{ ...selected.mentions[0], end: 999 }] }),
        selected.text,
      ),
    ).toBeNull();
    expect(readPromptClipboard("{", "")).toBeNull();
  });
  it("round-trips literal text, whitespace, duplicate basenames and paths containing spaces", () => {
    const text = "  Проверь @src/a file.ts\nи @tests/a file.ts  ";
    const mentions: MentionSpan[] = [
      { start: 10, end: 24, path: "src/a file.ts", kind: "file" },
      { start: 27, end: 43, path: "tests/a file.ts", kind: "file" },
    ].map((mention) => {
      const start = text.indexOf(`@${mention.path}`);
      return { ...mention, start, end: start + mention.path.length + 1, kind: "file" };
    });
    const doc = getSchema(promptExtensions).nodeFromJSON(promptContent(text, mentions));
    expect(promptSnapshot(doc)).toEqual({ text, mentions });
    expect(doc.firstChild?.childCount).toBe(5);
    for (let offset = 0; offset <= text.length; offset += 1) {
      if (mentions.some((mention) => mention.start < offset && offset < mention.end)) continue;
      expect(sourceOffset(editorPosition(offset, mentions), mentions)).toBe(offset);
    }
  });

  it("keeps arbitrary @ text literal without an explicit mention record", () => {
    const text = "@src/code.ts <script>bad()</script> user@example.com";
    const doc = getSchema(promptExtensions).nodeFromJSON(promptContent(text, []));
    expect(promptSnapshot(doc)).toEqual({ text, mentions: [] });
    expect(doc.firstChild?.childCount).toBe(1);
  });
});

describe("composer popovers", () => {
  it("flips below a high anchor, clamps horizontally and follows a smaller visible viewport", () => {
    expect(
      popoverPlacement(
        { left: 1120, top: 100, bottom: 140 },
        { left: 0, top: 0, width: 1180, height: 640 },
        328,
        360,
      ),
    ).toEqual({ left: 844, top: 148, width: 328, maxHeight: 360 });
    const viewport = { left: 50, top: 80, width: 300, height: 240 };
    const placement = popoverPlacement({ left: 120, top: 280, bottom: 310 }, viewport, 328, 360);
    expect(placement).toEqual({ left: 58, top: 88, width: 284, maxHeight: 184 });
    expect(popoverPlacement({ left: 500, top: 900, bottom: 940 }, viewport, 328, 360)).toEqual({
      left: 58,
      top: 88,
      width: 284,
      maxHeight: 224,
    });
  });
});
