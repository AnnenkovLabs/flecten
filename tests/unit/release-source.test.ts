import { expect, test } from "bun:test";

const {
  REQUIRED_JOBS,
  validateGates,
  validateSourceRun,
  validateSourceArtifact,
} = require("../../scripts/release-source.mjs");
const { validateExistingAssets } = require("../../scripts/promote-release.mjs");
const sha = "a".repeat(40);
const repo = { full_name: "AnnenkovLabs/flecten" };
const run = {
  id: 123,
  run_attempt: 2,
  workflow_id: 456,
  path: ".github/workflows/ci.yml",
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  repository: repo,
  head_repository: repo,
};
const artifact = {
  id: 789,
  name: "release-candidate-2",
  expired: false,
  digest: `sha256:${"b".repeat(64)}`,
  workflow_run: { id: 123, head_sha: sha },
};

test("promotion accepts only the trusted main workflow for the exact source commit", () => {
  expect(validateSourceRun(run, sha, 456).id).toBe(123);
  expect(validateSourceRun({ ...run, event: "workflow_dispatch" }, sha, 456).id).toBe(123);
  for (const change of [
    { repository: { full_name: "attacker/flecten" } },
    { head_repository: { full_name: "attacker/flecten" } },
    { workflow_id: 999 },
    { path: ".github/workflows/other.yml" },
    { head_sha: "c".repeat(40) },
    { head_branch: "feature" },
    { event: "pull_request" },
    { status: "in_progress" },
    { conclusion: "failure" },
  ])
    expect(() => validateSourceRun({ ...run, ...change }, sha, 456)).toThrow();
});

test("every required gate must succeed; skipped and missing jobs block promotion", () => {
  const jobs = REQUIRED_JOBS.map((name: string) => ({ name, conclusion: "success" }));
  expect(() => validateGates(jobs)).not.toThrow();
  for (const conclusion of ["skipped", "neutral", "cancelled", "failure", null]) {
    expect(() => validateGates([...jobs.slice(0, -1), { ...jobs.at(-1), conclusion }])).toThrow(
      "not green",
    );
  }
  expect(() => validateGates(jobs.slice(1))).toThrow("not green");
  expect(() => validateGates([...jobs, jobs[0]])).toThrow("not green");
});

test("expired candidates and artifacts from another run attempt cannot be selected", () => {
  expect(validateSourceArtifact(artifact, run).id).toBe(789);
  for (const change of [
    { expired: true },
    { name: "release-candidate-1" },
    { digest: "sha256:invalid" },
    { workflow_run: { id: 999, head_sha: sha } },
    { workflow_run: { id: 123, head_sha: "c".repeat(40) } },
  ])
    expect(() => validateSourceArtifact({ ...artifact, ...change }, run)).toThrow();
});

test("draft retry only fills missing bytes; published releases are immutable", () => {
  const file = { name: "installer.exe", size: 20, sha256: "d".repeat(64) };
  const asset = { name: file.name, size: file.size, digest: `sha256:${file.sha256}` };
  const release = {
    draft: true,
    prerelease: true,
    body: "Release notes",
    html_url: "https://github.com/AnnenkovLabs/flecten/releases/tag/v0.1.2",
    assets: [],
  };
  expect(validateExistingAssets(release, [file], "Release notes").draft).toBe(true);
  const published = { ...release, draft: false, assets: [asset] };
  expect(validateExistingAssets(published, [file], "Release notes").draft).toBe(false);
  expect(() =>
    validateExistingAssets(
      { ...release, assets: [{ ...asset, digest: `sha256:${"e".repeat(64)}` }] },
      [file],
      "Release notes",
    ),
  ).toThrow("conflicts");
  expect(() =>
    validateExistingAssets({ ...published, assets: [] }, [file], "Release notes"),
  ).toThrow("differs");
  expect(() => validateExistingAssets(published, [file], "Different notes")).toThrow("differs");
  expect(() =>
    validateExistingAssets(
      { ...published, assets: [asset, { ...asset, name: "unexpected.exe" }] },
      [file],
      "Release notes",
    ),
  ).toThrow("conflicts");
});
