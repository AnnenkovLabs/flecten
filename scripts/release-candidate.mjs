import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  artifactName,
  matchUpdateInfo,
  trustedUpdateKey,
  verifyUpdateManifest,
} from "../shell/update-signature.mjs";
import { releaseNotes } from "./release-notes.mjs";

const identity = z
  .object({
    repository: z.literal("AnnenkovLabs/flecten"),
    workflow: z.literal(".github/workflows/ci.yml"),
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    version: z.string().min(1).max(128),
    runId: z.number().int().positive(),
    runAttempt: z.number().int().positive(),
  })
  .strict();
const manifestSchema = identity
  .extend({
    schemaVersion: z.literal(1),
    files: z
      .array(
        z
          .object({
            name: z.string().transform(artifactName),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export const MANIFEST = "release-candidate.json";
const CHANNELS = ["beta", "beta-linux", "beta-mac"];

async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) throw new Error("Candidate contains a directory or symbolic link.");
    const name = artifactName(entry.name);
    if (name === MANIFEST) continue;
    const hash = createHash("sha256");
    let size = 0;
    for await (const bytes of createReadStream(join(directory, name))) {
      size += bytes.length;
      hash.update(bytes);
    }
    result.push({ name, size, sha256: hash.digest("hex") });
  }
  return result;
}

async function validateContents(directory, files, version, publicKey) {
  const names = new Set(files.map((file) => file.name));
  const required = ["SHA256SUMS.txt", "sbom.json", "release-notes.md"];
  for (const name of required)
    if (!names.has(name)) throw new Error(`Candidate is missing ${name}.`);
  // Fixed native targets, taken from electron-builder.yml. Both macOS architectures are mandatory.
  for (const name of [
    `Flecten-${version}-linux-x86_64.AppImage`,
    `Flecten-${version}-win-x64.exe`,
    ...["arm64", "x64"].flatMap((arch) => [
      `Flecten-${version}-mac-${arch}.dmg`,
      `Flecten-${version}-mac-${arch}.zip`,
    ]),
  ])
    if (!names.has(name)) throw new Error(`Candidate is missing installer ${name}.`);
  const key = trustedUpdateKey(publicKey);
  for (const channel of CHANNELS) {
    const info = Bun.YAML.parse(await readFile(join(directory, `${channel}.yml`), "utf8"));
    const envelope = JSON.parse(await readFile(join(directory, `${channel}.signed.json`), "utf8"));
    const signed = matchUpdateInfo(info, verifyUpdateManifest(envelope, key, channel));
    if (signed.version !== version)
      throw new Error(`Candidate metadata version mismatch: ${channel}.`);
    for (const file of signed.files) {
      const actual = files.find((entry) => entry.name === file.url);
      if (!actual || actual.size !== file.size)
        throw new Error(`Candidate artifact mismatch: ${file.url}.`);
      const hash = createHash("sha512");
      for await (const bytes of createReadStream(join(directory, file.url))) hash.update(bytes);
      if (hash.digest("base64") !== file.sha512)
        throw new Error(`Candidate SHA512 mismatch: ${file.url}.`);
    }
  }
  const sbom = JSON.parse(await readFile(join(directory, "sbom.json"), "utf8"));
  if (sbom?.metadata?.component?.version !== version)
    throw new Error("Candidate SBOM version mismatch.");
  const checksums = files.filter(
    (file) => !["SHA256SUMS.txt", "release-notes.md"].includes(file.name),
  );
  const expected = `${checksums
    .map((file) => `${file.sha256}  ${file.name}`)
    .sort()
    .join("\n")}\n`;
  const actual = `${(await readFile(join(directory, "SHA256SUMS.txt"), "utf8"))
    .trim()
    .split("\n")
    .sort()
    .join("\n")}\n`;
  if (expected !== actual) throw new Error("Candidate SHA256SUMS does not match its files.");
  if (!(await readFile(join(directory, "release-notes.md"), "utf8")).trim())
    throw new Error("Candidate release notes are empty.");
}

export async function createCandidate(directory, provenance, publicKey) {
  const source = identity.parse(provenance);
  const files = await inventory(directory);
  await validateContents(directory, files, source.version, publicKey);
  const manifest = manifestSchema.parse({ schemaVersion: 1, ...source, files });
  await writeFile(join(directory, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}

export async function verifyCandidate(directory, provenance, publicKey) {
  const expected = identity.parse(provenance);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(directory, MANIFEST), "utf8")),
  );
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) throw new Error(`Candidate provenance mismatch: ${key}.`);
  }
  const files = await inventory(directory);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files))
    throw new Error("Candidate file set or SHA256 changed.");
  await validateContents(directory, files, expected.version, publicKey);
  return manifest;
}

if (import.meta.main) {
  const [command, directory] = process.argv.slice(2);
  if (command !== "create" || !directory)
    throw new Error("Usage: release-candidate.mjs create <directory>");
  const { version } = await Bun.file("package.json").json();
  await writeFile(
    join(resolve(directory), "release-notes.md"),
    releaseNotes(await Bun.file("CHANGELOG.md").text(), version),
    { flag: "wx" },
  );
  await createCandidate(
    resolve(directory),
    {
      repository: process.env.GITHUB_REPOSITORY,
      workflow: ".github/workflows/ci.yml",
      sourceSha: process.env.GITHUB_SHA,
      version,
      runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    },
    process.env.UPDATE_SIGNING_PUBLIC_KEY,
  );
}
