import { expect, test } from "bun:test";

const { assertReleaseTag, releaseIdByTag } = require("../../scripts/promote-release.mjs");

test("promotion resolves annotated and lightweight remote release tags", () => {
  const commit = "a".repeat(40);
  const annotation = "b".repeat(40);
  const lightweight = `${commit}\trefs/tags/v0.1.2\n`;
  const annotated = `${annotation}\trefs/tags/v0.1.2\n${commit}\trefs/tags/v0.1.2^{}\n`;
  expect(() => assertReleaseTag(lightweight, "v0.1.2", commit)).not.toThrow();
  expect(() => assertReleaseTag(annotated, "v0.1.2", commit)).not.toThrow();
  for (const output of ["", annotated, lightweight]) {
    expect(() => assertReleaseTag(output, "v0.1.2", "c".repeat(40))).toThrow(
      "Remote release tag changed",
    );
  }
  expect(() => assertReleaseTag(annotated, "v0.1.2", annotation)).toThrow(
    "Remote release tag changed",
  );
});

test("promotion finds an existing draft by release ID and refuses duplicate tags", () => {
  const draft = { id: 445633133, tag_name: "v0.1.2", draft: true };
  const published = { id: 445306483, tag_name: "v0.1.1", draft: false };
  expect(releaseIdByTag([published, draft], "v0.1.2")).toBe(draft.id);
  expect(releaseIdByTag([published, draft], "v0.1.1")).toBe(published.id);
  expect(releaseIdByTag([published], "v0.1.2")).toBeUndefined();
  expect(() => releaseIdByTag([draft, { ...draft, id: 445633134 }], "v0.1.2")).toThrow(
    "Multiple releases",
  );
});
