import { expect, test } from "bun:test";
import { DictionaryCategorySchema, DictionaryIndexSchema } from "../../shared/dictionary";
import { PublicDictionary } from "../../src/dictionary/public";

test("every published dictionary category is bundled and all imported archive terms are available offline", async () => {
  const root = new URL("../../src/dictionary/data/", import.meta.url);
  const index = DictionaryIndexSchema.parse(await Bun.file(new URL("index.json", root)).json());
  const categories = await Promise.all(
    index.categories.map(async (filename) =>
      DictionaryCategorySchema.parse(await Bun.file(new URL(filename, root)).json()),
    ),
  );
  const published = categories.flatMap((category) => category.entries);
  const bundled = new PublicDictionary("/unused").snapshot().entries;
  expect(published).toHaveLength(118);
  expect(new Set(published.map((entry) => entry.id)).size).toBe(published.length);
  expect(bundled.filter((entry) => entry.id.startsWith("mera-"))).toHaveLength(111);
  expect(
    bundled.map(({ source: _source, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(published.sort((a, b) => a.id.localeCompare(b.id)));
});
