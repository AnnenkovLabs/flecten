import { expect, test } from "bun:test";
import {
  restoredThreadTop,
  saveThreadPosition,
  threadPosition,
} from "../../ui/src/lib/thread-position";

test("a thread keeps its reading position independently from another task", () => {
  saveThreadPosition("reading", { top: 340, atEnd: false, seenMessages: 8 });
  saveThreadPosition("following", { top: 600, atEnd: true, seenMessages: 4 });
  expect(threadPosition("reading")).toEqual({ top: 340, atEnd: false, seenMessages: 8 });
  expect(restoredThreadTop(threadPosition("reading"), 1600, 400)).toBe(340);
  expect(restoredThreadTop(threadPosition("following"), 1600, 400)).toBe(1200);
});

test("new threads follow the end and restored positions fit the new viewport", () => {
  expect(restoredThreadTop(undefined, 1600, 400)).toBe(1200);
  expect(restoredThreadTop({ top: 900, atEnd: false, seenMessages: 0 }, 600, 400)).toBe(200);
  expect(restoredThreadTop({ top: 100, atEnd: false, seenMessages: 0 }, 100, 400)).toBe(0);
});
