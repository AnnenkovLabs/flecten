import { expect, test } from "bun:test";
import { DictionaryEntrySchema } from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

const allEntries = new PublicDictionary("/unused").snapshot().entries;
const brainrotEntry = allEntries.find((entry) => entry.id === "brainrot");
const matchedIds = (prompt: string) =>
  matchDictionary(prompt, allEntries).map(({ entry }) => entry.id);

test("Brainrot entry is valid, bundled and covers English, Russian, Ukrainian and meme character forms", () => {
  if (!brainrotEntry) throw new Error("Missing bundled Brainrot definition");
  const { source: _source, ...entry } = brainrotEntry;
  expect(DictionaryEntrySchema.safeParse(entry).success).toBe(true);
  expect(entry.definition).not.toContain("\u2014");
  expect(entry.clarification ?? "").not.toContain("\u2014");

  for (const prompt of [
    "Brainrot",
    "brain rot",
    "brain-rot",
    "brainrots",
    "Italian Brainrot",
    "Steal a Brainrot",
    "Это чистый брейнрот",
    "Не делай бреинрот",
    "Конвейерные бреинроты в роблоксе",
    "Итальянские брейнроты в рилзах",
    "Це якийсь бреінрот",
    "видосы с баллериной капучиной",
    "балерина капучина",
    "траллалело тралала",
    "Tralalero Tralala",
    "Bombardiro Crocodilo",
    "Tung Tung Tung Sahur",
    "Cappuccino Assassino",
    "брр брр патапим",
    "шимпанзини бананини",
    "икфшткще",
    "brainrott",
  ]) {
    expect(matchedIds(prompt), prompt).toContain("brainrot");
  }
});

test("Brainrot does not hijack Context rot or unrelated words", () => {
  expect(matchedIds("We are hitting context rot on long sessions")).toEqual(["mera-tw5eb01b68"]);
  expect(matchedIds("This PR is AI slop")).toEqual(["mera-tw4b4c314f"]);
  expect(matchedIds("Убери этот слопный дизайн и нейрослоп")).toEqual(["mera-tw4b4c314f"]);
  expect(matchedIds("Avoid UI slop and AI design slop")).toEqual(["mera-tw4b4c314f"]);
  for (const prompt of ["brain", "rotten", "brainstorm", "rotary"]) {
    expect(matchedIds(prompt), prompt).not.toContain("brainrot");
  }
});
