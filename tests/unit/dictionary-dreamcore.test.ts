import { expect, test } from "bun:test";
import { DictionaryEntrySchema } from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

const allEntries = new PublicDictionary("/unused").snapshot().entries;
const dreamcoreEntry = allEntries.find((entry) => entry.id === "liminal-dreamcore-music");
const matchedIds = (prompt: string) =>
  matchDictionary(prompt, allEntries).map(({ entry }) => entry.id);

test("Dreamcore / Liminal music entry is valid, bundled and covers English, Russian and Ukrainian forms", () => {
  if (!dreamcoreEntry) throw new Error("Missing bundled Dreamcore / Liminal music definition");
  const { source: _source, ...entry } = dreamcoreEntry;
  expect(DictionaryEntrySchema.safeParse(entry).success).toBe(true);
  expect(entry.definition).not.toContain("\u2014");
  expect(entry.clarification ?? "").not.toContain("\u2014");

  for (const prompt of [
    "Dreamcore",
    "7 Weeks 3 Days (Dreamcore Version)",
    "7 Weeks 3 Days (Backrooms Version)",
    "liminal music",
    "liminal ambient",
    "Weirdcore music",
    "Poolrooms ambient",
    "Mallsoft",
    "Добавь лиминальные песни в плейлист",
    "Хочу дримкор атмосферу",
    "бэкрумс версия трека",
    "музыка пулрумс",
    "вірдкор і дрімкор",
    "лімінальна музика",
  ]) {
    expect(matchedIds(prompt), prompt).toContain("liminal-dreamcore-music");
  }
});

test("Dreamcore / Liminal music does not match unrelated words", () => {
  for (const prompt of ["dream", "dreams", "limit", "back", "core", "mall"]) {
    expect(matchedIds(prompt), prompt).not.toContain("liminal-dreamcore-music");
  }
});
