import { expect, test } from "bun:test";
import { DictionaryEntrySchema } from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

const entries = new PublicDictionary("/unused")
  .snapshot()
  .entries.filter((entry) => entry.id === "oh-my-pi");
const matches = (prompt: string) =>
  matchDictionary(prompt, entries).filter(({ entry }) => entry.id === "oh-my-pi");

test("Oh My Pi covers every declared first, middle and last syllable in mixed scripts", () => {
  for (const first of ["о", "оу", "ох", "oh", "o"]) {
    for (const middle of ["my", "май", "маи", "ма"]) {
      for (const last of ["пай", "паи", "пи", "pi"]) {
        const parts = [first, middle, last];
        expect(entries[0]?.aliases).toContain(parts.join(" "));
        for (const separator of [" ", "-", ""]) {
          const prompt = parts.join(separator);
          expect(matches(prompt), prompt).toHaveLength(1);
        }
      }
    }
  }
  const record = entries[0];
  if (!record) throw new Error("Missing bundled Oh My Pi definition");
  const { source: _source, ...entry } = record;
  expect(DictionaryEntrySchema.safeParse(entry).success).toBe(true);
  expect(
    DictionaryEntrySchema.safeParse({ ...entry, aliases: Array(129).fill("alias") }).success,
  ).toBe(false);
});

test("Oh My Pi resolves abbreviations, phonetic spellings, inflections and package names", () => {
  const entry = entries.find((entry) => entry.id === "oh-my-pi");
  expect(entry).toBeDefined();
  for (const prompt of [
    "Oh My Pi",
    "OH MY PI",
    "OhMyPi",
    "oh-my-pi",
    "oh‑my‑pi",
    "oh\nmy\tpi",
    "Ｏｈ　Ｍｙ　Ｐｉ",
    "OMP",
    "O M P",
    "О М П",
    "о-май-пай",
    "охмайпай",
    "оумайпай",
    "оймайпай",
    "омайпи",
    "охмайпи",
    "оумайпи",
    "Сравни харнессы омп и Pi",
    "Работаю в /projects/oh-my-pi",
    "https://omp.sh",
    "@oh-my-pi/pi-coding-agent",
    ...(entry?.aliases ?? []),
  ]) {
    expect(matches(prompt), prompt).toHaveLength(1);
  }
});

test("Oh My Pi does not match Oh My Posh, OpenMP or fragments of other words", () => {
  for (const prompt of [
    "Oh My Posh",
    "oh-my-posh init pwsh",
    "ох май пош",
    "OpenMP",
    "OMP_NUM_THREADS=4",
    "component",
    "compile",
    "prompt",
    "preOhMyPiSuffix",
  ]) {
    expect(matches(prompt), prompt).toHaveLength(0);
  }
});
