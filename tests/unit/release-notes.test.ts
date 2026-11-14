import { expect, test } from "bun:test";

const { releaseNotes } = require("../../scripts/release-notes.mjs") as {
  releaseNotes(markdown: string, version: string): string;
};

test("release publication uses only its curated changelog section and preserves Markdown", () => {
  const markdown = [
    "# Изменения",
    "",
    "## Не выпущено",
    "",
    "Будущие изменения.",
    "",
    "## 0.1.1",
    "",
    "Новая альфа.",
    "",
    "### Исправлено",
    "",
    "- **История** сохраняется.",
    "",
    "```md",
    "## Это пример, а не граница релиза",
    "```",
    "",
    "## 0.1.0",
    "",
    "Старый релиз.",
  ].join("\n");
  expect(releaseNotes(markdown, "0.1.1")).toBe(
    "Новая альфа.\n\n### Исправлено\n\n- **История** сохраняется.\n\n```md\n## Это пример, а не граница релиза\n```\n",
  );
  expect(() => releaseNotes(markdown, "0.2.0")).toThrow("exactly one heading");
  expect(() => releaseNotes(`${markdown}\n## 0.1.1\nПовтор.`, "0.1.1")).toThrow(
    "exactly one heading",
  );
  expect(() => releaseNotes("## 0.1.1\n\n## 0.1.0\nСтарый.", "0.1.1")).toThrow("no release notes");
});
