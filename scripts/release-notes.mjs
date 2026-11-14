import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { z } from "zod";

export function releaseNotes(markdown, version) {
  const headings = fromMarkdown(markdown).children.filter(
    (node) => node.type === "heading" && node.depth === 2,
  );
  const matches = headings.filter(
    (node) =>
      node.children.length === 1 &&
      node.children[0].type === "text" &&
      node.children[0].value === version,
  );
  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one heading: ## ${version}`);
  }
  const heading = matches[0];
  const next = headings[headings.indexOf(heading) + 1];
  const notes = markdown.slice(heading.position.end.offset, next?.position.start.offset).trim();
  if (!notes) throw new Error(`CHANGELOG.md has no release notes for ${version}`);
  return `${notes}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = z
    .object({ version: z.string().min(1) })
    .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
  if (
    process.env.GITHUB_REF_NAME &&
    (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== `v${version}`)
  ) {
    throw new Error(`Release must run against tag v${version}`);
  }
  const output = process.argv[2];
  if (!output) throw new Error("Usage: bun scripts/release-notes.mjs <output.md>");
  const markdown = await readFile(join(root, "CHANGELOG.md"), "utf8");
  await writeFile(output, releaseNotes(markdown, version));
}
