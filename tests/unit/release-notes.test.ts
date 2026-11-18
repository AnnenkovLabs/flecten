import { expect, test } from "bun:test";

const { releaseNotes } = require("../../scripts/release-notes.mjs") as {
  releaseNotes(markdown: string, version: string): string;
};

test("release publication uses only its curated changelog section and preserves Markdown", () => {
  const markdown = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "Upcoming changes.",
    "",
    "## 0.1.1",
    "",
    "New alpha.",
    "",
    "### Fixed",
    "",
    "- **History** persists across restarts.",
    "",
    "```md",
    "## Example heading, not a release boundary",
    "```",
    "",
    "## 0.1.0",
    "",
    "Previous release.",
  ].join("\n");
  expect(releaseNotes(markdown, "0.1.1")).toBe(
    "New alpha.\n\n### Fixed\n\n- **History** persists across restarts.\n\n```md\n## Example heading, not a release boundary\n```\n",
  );
  expect(() => releaseNotes(markdown, "0.2.0")).toThrow("exactly one heading");
  expect(() => releaseNotes(`${markdown}\n## 0.1.1\nDuplicate.`, "0.1.1")).toThrow(
    "exactly one heading",
  );
  expect(() => releaseNotes("## 0.1.1\n\n## 0.1.0\nOlder.", "0.1.1")).toThrow("no release notes");
});
