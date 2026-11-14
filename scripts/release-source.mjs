import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { z } from "zod";

export const REPOSITORY = "AnnenkovLabs/flecten";
export const REQUIRED_JOBS = [
  ...["ubuntu-latest", "macos-latest", "windows-latest"].map((os) => `verify (${os})`),
  "quality / docs and coverage",
  ...[1, 2, 3].map((shard) => `quality / Electron and visual regression (${shard}/3)`),
  ...["linux", "macos-arm64", "macos-x64", "windows"].map(
    (platform) => `installers / package (${platform})`,
  ),
  "ready to release",
];
const repositorySchema = z.object({ full_name: z.literal(REPOSITORY) });
const runSchema = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  workflow_id: z.number().int().positive(),
  path: z.literal(".github/workflows/ci.yml"),
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
  head_branch: z.literal("main"),
  event: z.enum(["push", "workflow_dispatch"]),
  status: z.literal("completed"),
  conclusion: z.literal("success"),
  repository: repositorySchema,
  head_repository: repositorySchema,
});
const artifactSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  expired: z.literal(false),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  workflow_run: z.object({ id: z.number().int().positive(), head_sha: z.string() }),
});

export function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
}
export function api(path) {
  return JSON.parse(gh(["api", `repos/${REPOSITORY}/${path}`]));
}
export function validateSourceRun(value, sha, workflowId) {
  const run = runSchema.parse(value);
  if (run.head_sha !== sha || run.workflow_id !== workflowId)
    throw new Error("Candidate run SHA or workflow does not match.");
  return run;
}
export function validateGates(jobs) {
  const parsed = z
    .array(z.object({ name: z.string(), conclusion: z.string().nullable() }))
    .parse(jobs);
  for (const name of REQUIRED_JOBS) {
    const matching = parsed.filter((job) => job.name === name);
    if (matching.length !== 1 || matching[0].conclusion !== "success")
      throw new Error(`Required candidate gate is not green: ${name}.`);
  }
}
export function validateSourceArtifact(value, run) {
  const artifact = artifactSchema.parse(value);
  if (
    artifact.name !== `release-candidate-${run.run_attempt}` ||
    artifact.workflow_run.id !== run.id ||
    artifact.workflow_run.head_sha !== run.head_sha
  )
    throw new Error("Candidate artifact does not belong to the verified run attempt.");
  return artifact;
}

export async function findCandidate(sha) {
  const workflow = z
    .object({ id: z.number().int().positive() })
    .parse(api("actions/workflows/ci.yml"));
  const response = z
    .object({ workflow_runs: z.array(z.unknown()) })
    .parse(
      api(
        `actions/workflows/${workflow.id}/runs?head_sha=${encodeURIComponent(sha)}&branch=main&status=success&per_page=100`,
      ),
    );
  for (const value of response.workflow_runs) {
    const parsed = runSchema.safeParse(value);
    if (!parsed.success || parsed.data.head_sha !== sha || parsed.data.workflow_id !== workflow.id)
      continue;
    const run = validateSourceRun(value, sha, workflow.id);
    const artifacts = z
      .object({ artifacts: z.array(z.unknown()) })
      .parse(api(`actions/runs/${run.id}/artifacts?per_page=100`));
    const matches = artifacts.artifacts.filter(
      (item) => item?.name === `release-candidate-${run.run_attempt}`,
    );
    if (matches.length !== 1 || matches[0]?.expired) continue;
    const artifact = validateSourceArtifact(matches[0], run);
    const jobs = z
      .object({ jobs: z.array(z.unknown()), total_count: z.number().int() })
      .parse(api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`));
    // The workflow has twelve required gates. Refuse truncated API responses.
    if (jobs.jobs.length !== jobs.total_count)
      throw new Error("Candidate job response is incomplete.");
    validateGates(jobs.jobs);
    return { run, artifact };
  }
  throw new Error(
    `No verified release candidate for ${sha}. See https://github.com/${REPOSITORY}/actions/workflows/ci.yml. Wait for CI or run: gh workflow run ci.yml --ref main`,
  );
}

if (import.meta.main) {
  const sha = process.env.GITHUB_SHA;
  if (!sha || process.env.GITHUB_REF_TYPE !== "tag")
    throw new Error("Release must run against a version tag.");
  const { version } = await Bun.file("package.json").json();
  if (process.env.GITHUB_REF_NAME !== `v${version}`)
    throw new Error(`Release tag must be v${version}.`);
  const { run, artifact } = await findCandidate(sha);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `run_id=${run.id}\nrun_attempt=${run.run_attempt}\nartifact_id=${artifact.id}\nartifact_digest=${artifact.digest}\n`,
  );
}
