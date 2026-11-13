import { truncateMiddle } from "./truncate";

/** A CommonMark delimiter longer than every backtick run in the enclosed source. */
function delimiter(text: string, minimum: number): string {
  let longest = 0;
  let run = 0;
  for (const character of text) {
    run = character === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return "`".repeat(Math.max(minimum, longest + 1));
}

/** Metadata is an inline code span, so paths and remote labels cannot create Markdown. */
export function markdownValue(value: string | number | boolean): string {
  const text = String(value).replaceAll("\r", " ").replaceAll("\n", " ");
  const fence = delimiter(text, 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

/** Preserve source bytes inside a normal fenced code block that its contents cannot close. */
export function markdownCode(text: string, language = "text"): string {
  const fence = delimiter(text, 3);
  return `${fence}${language}\n${text}\n${fence}`;
}

export function markdownData(
  title: string,
  fields: ReadonlyArray<readonly [string, string | number | boolean | undefined]>,
  text: string,
): string {
  return [
    `## ${title}`,
    "",
    ...fields.flatMap(([name, value]) =>
      value === undefined ? [] : [`- ${name}: ${markdownValue(value)}`],
    ),
    "",
    markdownCode(text),
  ].join("\n");
}

/** Clip serialized source data before enclosing it in a complete CommonMark block. */
export function markdownExcerpt(
  title: string,
  fields: ReadonlyArray<readonly [string, string | number | boolean | undefined]>,
  text: string,
  maxBytes: number,
): string {
  let room = Math.max(0, Math.floor(maxBytes));
  let rendered = markdownData(title, fields, truncateMiddle(text, room).text);
  while (room > 0 && Buffer.byteLength(rendered, "utf8") > maxBytes) {
    room = Math.max(0, room - (Buffer.byteLength(rendered, "utf8") - maxBytes));
    rendered = markdownData(title, fields, truncateMiddle(text, room).text);
  }
  return Buffer.byteLength(rendered, "utf8") <= maxBytes ? rendered : "";
}
