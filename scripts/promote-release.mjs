import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { MANIFEST, verifyCandidate } from "./release-candidate.mjs";
import { api, gh, REPOSITORY } from "./release-source.mjs";

const assetSchema = z.object({
  name: z.string(),
  size: z.number().int(),
  digest: z.string().nullable(),
});
const releaseSchema = z.object({
  draft: z.boolean(),
  prerelease: z.boolean(),
  body: z.string().nullable(),
  html_url: z.string().url(),
  assets: z.array(assetSchema),
});

export function assertReleaseTag(output, tag, sha) {
  const refs = new Map(
    output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.split("\t");
        return [ref, commit];
      }),
  );
  if ((refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`)) !== sha)
    throw new Error("Remote release tag changed after preparation.");
}

export function validateExistingAssets(release, files, notes) {
  const current = releaseSchema.parse(release);
  for (const asset of current.assets) {
    const file = files.find((file) => file.name === asset.name);
    if (!file || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`)
      throw new Error(
        `Existing release asset conflicts with candidate: ${asset.name}. Use a new version.`,
      );
  }
  if (
    !current.draft &&
    (current.assets.length !== files.length ||
      current.body?.trim() !== notes.trim() ||
      !current.prerelease)
  )
    throw new Error("Published release differs from candidate. Use a new version.");
  return current;
}

export async function promoteRelease(directory) {
  const { version } = await Bun.file("package.json").json();
  const tag = `v${version}`;
  if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== tag)
    throw new Error(`Release must run against tag ${tag}.`);
  const sha = process.env.GITHUB_SHA;
  const manifest = await verifyCandidate(
    directory,
    {
      repository: REPOSITORY,
      workflow: ".github/workflows/ci.yml",
      sourceSha: sha,
      version,
      runId: Number(process.env.CANDIDATE_RUN_ID),
      runAttempt: Number(process.env.CANDIDATE_RUN_ATTEMPT),
    },
    process.env.UPDATE_SIGNING_PUBLIC_KEY,
  );
  const notesFile = resolve(directory, "release-notes.md");
  const notes = await Bun.file(notesFile).text();
  const manifestBytes = await Bun.file(resolve(directory, MANIFEST)).arrayBuffer();
  const files = [
    ...manifest.files,
    {
      name: MANIFEST,
      size: manifestBytes.byteLength,
      sha256: createHash("sha256").update(Buffer.from(manifestBytes)).digest("hex"),
    },
  ];
  const assertTag = () => {
    // The ref can be an annotated tag. Peel it to the actual commit through git.
    const output = execFileSync(
      "git",
      [
        "ls-remote",
        "--tags",
        `https://github.com/${REPOSITORY}.git`,
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ],
      { encoding: "utf8" },
    );
    assertReleaseTag(output, tag, sha);
  };
  assertTag();
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (response.status !== 404 && !response.ok)
    throw new Error(`GitHub release lookup failed: ${response.status}.`);
  if (response.status === 404) {
    gh([
      "release",
      "create",
      tag,
      "--repo",
      REPOSITORY,
      "--verify-tag",
      "--draft",
      "--prerelease",
      "--title",
      `Flecten ${version} Alpha`,
      "--notes-file",
      notesFile,
    ]);
  }
  let release = validateExistingAssets(api(`releases/tags/${tag}`), files, notes);
  if (release.draft) {
    const missing = files.filter(
      (file) => !release.assets.some((asset) => asset.name === file.name),
    );
    if (missing.length)
      gh([
        "release",
        "upload",
        tag,
        "--repo",
        REPOSITORY,
        ...missing.map((file) => resolve(directory, file.name)),
      ]);
    release = validateExistingAssets(api(`releases/tags/${tag}`), files, notes);
    if (release.assets.length !== files.length) throw new Error("Release upload is incomplete.");
    assertTag();
    gh([
      "release",
      "edit",
      tag,
      "--repo",
      REPOSITORY,
      "--draft=false",
      "--prerelease",
      "--title",
      `Flecten ${version} Alpha`,
      "--notes-file",
      notesFile,
    ]);
    release = validateExistingAssets(api(`releases/tags/${tag}`), files, notes);
    if (release.draft) throw new Error("GitHub Release is still a draft.");
  }
  console.log(release.html_url);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Published verified candidate: ${release.html_url}\nSource: ${sha}, CI run: ${manifest.runId}\n`,
    );
}

if (import.meta.main) await promoteRelease(resolve(process.argv[2] ?? "release"));
