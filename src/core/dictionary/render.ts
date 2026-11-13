import type { DictionaryMatch } from "../../../shared/dictionary";
import { markdownData } from "../../util/markdown";

/** Keep the definition before optional detail, clipping only when the definition itself is too large. */
export function renderDictionaryMatch(
  { entry, matchedAlias }: DictionaryMatch,
  fits: (block: string) => boolean,
): string | undefined {
  const fields = [
    ["Term", entry.term],
    ["Matched alias", matchedAlias],
    ["Category", entry.category],
    ["Dictionary", entry.source],
    ["Identifier", entry.id],
    ["Revision", entry.revision],
  ] as const;
  const definition = `Definition:\n${entry.definition}`;
  const clarification = entry.clarification ? `Clarification:\n${entry.clarification}` : undefined;
  const sources = entry.sources.length ? `Sources:\n${entry.sources.join("\n")}` : undefined;
  const sections = [definition, clarification, sources].filter(
    (section): section is string => section !== undefined,
  );
  while (sections.length > 0) {
    const block = markdownData("Term definition", fields, sections.join("\n\n"));
    if (fits(block)) return block;
    sections.pop();
  }
  const characters = [...entry.definition];
  let start = 1;
  let end = characters.length - 1;
  let excerpt: string | undefined;
  while (start <= end) {
    const length = Math.floor((start + end) / 2);
    const block = markdownData(
      "Term definition",
      [...fields, ["Definition truncated", true]],
      `Definition:\n${characters.slice(0, length).join("")}…`,
    );
    if (fits(block)) {
      excerpt = block;
      start = length + 1;
    } else end = length - 1;
  }
  return excerpt;
}
