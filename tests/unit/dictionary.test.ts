import { describe, expect, test } from "bun:test";
import {
  DictionaryCategorySchema,
  DictionaryIndexSchema,
  type DictionaryRecord,
} from "../../shared/dictionary";
import { matchDictionary } from "../../src/dictionary/match";
import { PublicDictionary } from "../../src/dictionary/public";

function entry(id: string, term: string, aliases: string[] = []): DictionaryRecord {
  return {
    id,
    term,
    aliases,
    category: "test",
    definition: `${term} definition`,
    sources: [],
    source: "public",
  };
}
const ids = (prompt: string, entries: DictionaryRecord[]) =>
  matchDictionary(prompt, entries).map(({ entry }) => entry.id);

const publicEntries = new PublicDictionary("/unused").snapshot().entries;

describe("dictionary resolution", () => {
  test("resolves case, Unicode, whitespace, hyphens, explicit Cyrillic aliases and inflections", () => {
    for (const prompt of [
      "Use Liquid Glass",
      "Use ＬＩＱＵＩＤ　ＧＬＡＳＳ",
      "Liquid\nGlass",
      "liquid-glass",
      "ликвид гласс",
      "рідке скло",
    ])
      expect(ids(prompt, publicEntries)).toEqual(["liquid-glass"]);
    for (const prompt of [
      "vibe coding",
      "VIBECODING",
      "vibe-coding",
      "вайбкодинг",
      "вайбкодинга",
      "вайб-кодинг",
      "вайб кодинг",
      "вайбкодінгом",
    ]) {
      expect(ids(prompt, publicEntries)).toEqual(["vibe-coding"]);
    }
  });

  test("recovers one typo, neighboring transposition and wrong Russian/Ukrainian keyboard layouts", () => {
    for (const prompt of [
      "Liqud Glass",
      "vibecodign",
      "вайпкодинг",
      "мшиусщвштп",
      "дшйгшв пдфыы",
      "дшйгшв пдфіі",
    ]) {
      expect(ids(prompt, publicEntries)).toHaveLength(1);
    }
    expect(ids("Use мшиусщвштп", publicEntries)).toEqual(["vibe-coding"]);
  });

  test("preserves whole word and punctuation boundaries, exact short terms and unrelated text", () => {
    const entries = [entry("js", "JS"), entry("cplusplus", "C++"), ...publicEntries];
    expect(ids("JS, C++", entries)).toEqual(["js", "cplusplus"]);
    for (const prompt of [
      "vibecodingness",
      "preLiquidGlassSuffix",
      "JSON",
      "Liquid. Glass",
      "quiet programming",
    ]) {
      expect(ids(prompt, entries)).toEqual([]);
    }
    expect(ids("JT", entries)).toEqual([]);
  });

  test("abstains from equally close typos and ambiguous public aliases", () => {
    const entries = [entry("first", "abcdefgh"), entry("second", "abcdefgi")];
    expect(ids("abcdefgj", entries)).toEqual([]);
    expect(ids("abcdefgi", entries)).toEqual(["second"]);
    expect(ids("shared", [entry("first", "shared"), entry("second", "shared")])).toEqual([]);
  });

  test("selects longest phrases, deduplicates repeats and gives local definitions priority", () => {
    const entries = [entry("glass", "Glass"), entry("liquid-glass", "Liquid Glass")];
    expect(ids("Liquid Glass and Liquid Glass", entries)).toEqual(["liquid-glass"]);
    const local = {
      ...entry("liquid-glass", "Liquid Glass"),
      source: "local" as const,
      definition: "Local meaning",
    };
    expect(matchDictionary("Liquid Glass", [...entries, local])[0]?.entry.definition).toBe(
      "Local meaning",
    );
    expect(matchDictionary("Liquid Glass", [local, ...entries])[0]?.entry.source).toBe("local");
  });

  test("validates categories and rejects manifest paths outside the data folder", () => {
    expect(
      DictionaryIndexSchema.safeParse({ schemaVersion: 1, categories: ["../secrets.json"] })
        .success,
    ).toBe(false);
    expect(
      DictionaryIndexSchema.safeParse({ schemaVersion: 1, categories: [".json"] }).success,
    ).toBe(false);
    expect(
      DictionaryCategorySchema.safeParse({
        schemaVersion: 1,
        category: "other",
        entries: [entry("first", "Term")],
      }).success,
    ).toBe(false);
    const { source: _, ...valid } = entry("first", "Term");
    expect(
      DictionaryCategorySchema.safeParse({
        schemaVersion: 1,
        category: "test",
        entries: [valid, valid],
      }).success,
    ).toBe(false);
  });
});
