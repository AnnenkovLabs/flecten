import { expect, test } from "bun:test";
import { DictionaryEntrySchema } from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

const allEntries = new PublicDictionary("/unused").snapshot().entries;
const funkEntry = allEntries.find((entry) => entry.id === "funk-phonk");
const matchedIds = (prompt: string) =>
  matchDictionary(prompt, allEntries).map(({ entry }) => entry.id);

test("Funk entry is valid, bundled and covers phonk-branch Funk and its subgenres", () => {
  if (!funkEntry) throw new Error("Missing bundled Funk definition");
  const { source: _source, ...entry } = funkEntry;
  expect(DictionaryEntrySchema.safeParse(entry).success).toBe(true);
  expect(entry.definition).not.toContain("\u2014");
  expect(entry.clarification ?? "").not.toContain("\u2014");

  for (const prompt of [
    "Funk",
    "Brazilian Phonk",
    "Brazilian Funk",
    "Поставь фанк для эдита",
    "Напиши бит в стиле бразильский фонк",
    "Montagem",
    "монтажем",
    "MTG funk",
    "Montacraft",
    "монтакрафт",
    "Minecraft Phonk",
    "Automotivo",
    "Mandelão",
    "манделао",
    "Bruxaria",
    "Krushfunk",
    "Mega Funk",
    "Submundo",
    "Ritmadinha",
    "Jumpstyle Funk",
    "Funk Rave",
    "Funk Proibidão",
    "Slowed + Reverb",
    "супер слоуд",
    "ультра слоуд",
    "фанк рок версия",
    "metal funk",
    "басс буст фанк",
  ]) {
    expect(matchedIds(prompt), prompt).toContain("funk-phonk");
  }
});

test("Funk does not hijack unrelated words or bare MTG", () => {
  for (const prompt of ["function", "functional", "MTG deck", "defunkt", "skunk"]) {
    expect(matchedIds(prompt), prompt).not.toContain("funk-phonk");
  }
});
