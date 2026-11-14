import { execFileSync } from "node:child_process";
import { findCandidate, REPOSITORY } from "./release-source.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export async function publishPreparedRelease() {
  if (git(["branch", "--show-current"]) !== "main") throw new Error("Publish releases from main.");
  const sha = git(["rev-parse", "HEAD"]);
  const remote = git([
    "ls-remote",
    `https://github.com/${REPOSITORY}.git`,
    "refs/heads/main",
  ]).split("\t")[0];
  if (remote !== sha) throw new Error("Push main before publishing this commit.");
  const { version } = JSON.parse(git(["show", `${sha}:package.json`]));
  const tag = `v${version}`;
  if (git(["ls-remote", "--tags", `https://github.com/${REPOSITORY}.git`, `refs/tags/${tag}`]))
    throw new Error(`${tag} already exists. Retry with: gh workflow run release.yml --ref ${tag}`);
  const { run } = await findCandidate(sha);
  console.log(`Verified candidate: https://github.com/${REPOSITORY}/actions/runs/${run.id}`);
  const localTags = git(["tag", "--list", tag]);
  if (localTags) {
    if (git(["rev-parse", `${tag}^{commit}`]) !== sha)
      throw new Error(`Local ${tag} points to another commit.`);
  } else git(["tag", "-a", tag, "-m", `Flecten ${version} Alpha`, sha]);
  git(["push", `https://github.com/${REPOSITORY}.git`, `refs/tags/${tag}`]);
  console.log(
    `Release publication started: https://github.com/${REPOSITORY}/actions/workflows/release.yml`,
  );
  return tag;
}

if (import.meta.main) await publishPreparedRelease();
