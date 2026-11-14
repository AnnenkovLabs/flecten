import { expect, test } from "bun:test";

const { assertReleaseTag } = require("../../scripts/promote-release.mjs");

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
