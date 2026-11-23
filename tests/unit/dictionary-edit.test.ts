import { expect, test } from "bun:test";
import { DictionaryEntrySchema } from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

const allEntries = new PublicDictionary("/unused").snapshot().entries;
const editEntry = allEntries.find((entry) => entry.id === "video-edit");
const matchedIds = (prompt: string) =>
  matchDictionary(prompt, allEntries).map(({ entry }) => entry.id);

test("Video Edit entry is valid, bundled and covers Russian, Ukrainian and multi-word English forms", () => {
  if (!editEntry) throw new Error("Missing bundled Video Edit definition");
  const { source: _source, ...entry } = editEntry;
  expect(DictionaryEntrySchema.safeParse(entry).success).toBe(true);
  expect(entry.definition).not.toContain("\u2014");
  expect(entry.clarification ?? "").not.toContain("\u2014");

  for (const prompt of [
    "Сделай красивый эдит",
    "Эти эдиты просто шикарны",
    "Вайб как у Злуши в прайме",
    "zlusha",
    "Красивий едіт під музику",
    "Make a TikTok edit with velocity",
    "High-craft AE edit",
    "velocity edit with Twixtor",
    "3D car edit for Reels",
    "fan edit",
  ]) {
    expect(matchedIds(prompt), prompt).toContain("video-edit");
  }
});

test("Video Edit does not hijack coding prompts using the verb edit or editor", () => {
  for (const prompt of [
    "Edit src/app.ts",
    "Please edit the config file",
    "Open the text editor",
    "Apply this code edit",
    "editing a JSON schema",
  ]) {
    expect(matchedIds(prompt), prompt).not.toContain("video-edit");
  }
});
