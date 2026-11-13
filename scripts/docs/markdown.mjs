// Markdown readers for docs-check: sections, table names and fenced JSON examples.

/** Lines of the `## heading` section, without the heading line itself. */
export function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) break;
    out.push(lines[index]);
  }
  return out;
}

/** The first cell of a table row when it is one inline code name: "| `run` | ..." gives "run". */
function tableName(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return undefined;
  const cell = trimmed.slice(1).split("|")[0]?.trim() ?? "";
  if (cell.length < 3 || !cell.startsWith("`") || !cell.endsWith("`")) return undefined;
  const name = cell.slice(1, -1);
  return name.length > 0 && !name.includes("`") && !name.includes(" ") ? name : undefined;
}

/** Names in the first column of the tables of one section. */
export function parseTableNames(markdown, heading) {
  const names = new Set();
  for (const line of sectionLines(markdown, heading)) {
    const name = tableName(line);
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** Commands of the "Команды" section: table rows, lines that open with a name and JSON examples. */
export function parseProtocolCommands(markdown) {
  const commands = new Set();
  let fence = false;
  for (const line of sectionLines(markdown, "Команды")) {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) {
      const typed = line.match(/"type"\s*:\s*"([^"]+)"/);
      if (typed) commands.add(typed[1]);
      continue;
    }
    const name = tableName(line) ?? line.match(/^`([^`\n]+)`/)?.[1];
    if (name !== undefined) commands.add(name);
  }
  return [...commands];
}

export function parseToolNames(markdown) {
  const names = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([a-z0-9_]+)`\s*\|/i);
    if (match) names.add(match[1]);
  }
  return [...names];
}

export function parseJsonBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  let buffer;
  let lineNumber = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (buffer === undefined) {
      if (/^```json\s*$/.test(line.trim())) {
        buffer = [];
        lineNumber = index + 1;
      }
      continue;
    }
    if (/^```\s*$/.test(line.trim())) {
      const text = buffer.join("\n");
      try {
        blocks.push({ line: lineNumber, value: JSON.parse(text) });
      } catch (error) {
        blocks.push({
          line: lineNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      buffer = undefined;
      continue;
    }
    buffer.push(line);
  }
  return blocks;
}
