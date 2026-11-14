import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  createCandidate,
  verifyCandidate,
  MANIFEST,
} = require("../../scripts/release-candidate.mjs");
const { signUpdateManifests } = require("../../scripts/sign-update-manifests.mjs");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const provenance = {
  repository: "AnnenkovLabs/flecten",
  workflow: ".github/workflows/ci.yml",
  sourceSha: "a".repeat(40),
  version: "0.1.2",
  runId: 123,
  runAttempt: 1,
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flecten-candidate-"));
  roots.push(directory);
  const keypair = generateKeyPairSync("ed25519");
  const publicKey = keypair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const channels: Record<string, string[]> = {
    beta: ["win-x64.exe"],
    "beta-linux": ["linux-x86_64.AppImage"],
    "beta-mac": ["mac-arm64.dmg", "mac-arm64.zip", "mac-x64.dmg", "mac-x64.zip"],
  };
  for (const [channel, targets] of Object.entries(channels)) {
    const files = [];
    for (const target of targets) {
      const url = `Flecten-0.1.2-${target}`;
      const bytes = Buffer.from(`installer ${target}`);
      await writeFile(join(directory, url), bytes);
      files.push({
        url,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      });
    }
    await writeFile(
      join(directory, `${channel}.yml`),
      Bun.YAML.stringify({ version: "0.1.2", files }),
    );
  }
  await signUpdateManifests({ directory, privateKey, publicKey, version: "0.1.2" });
  await writeFile(
    join(directory, "sbom.json"),
    JSON.stringify({ metadata: { component: { version: "0.1.2" } } }),
  );
  await writeFile(
    join(directory, "release-notes.md"),
    "### Faster releases\n\nVerified native installers.\n",
  );
  await checksums(directory);
  return { directory, publicKey };
}

async function checksums(directory: string) {
  const files = (await readdir(directory))
    .filter((name) => ![MANIFEST, "SHA256SUMS.txt", "release-notes.md"].includes(name))
    .sort();
  const lines = [];
  for (const name of files) {
    lines.push(
      `${createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex")}  ${name}`,
    );
  }
  await writeFile(join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

test("a prepared, signed candidate is promoted with exactly the original bytes", async () => {
  const { directory, publicKey } = await fixture();
  const created = await createCandidate(directory, provenance, publicKey);
  expect(created.files).toHaveLength(15);
  expect(await verifyCandidate(directory, provenance, publicKey)).toEqual(created);
  for (const [field, value] of Object.entries({
    sourceSha: "b".repeat(40),
    version: "0.1.3",
    runId: 124,
    runAttempt: 2,
  })) {
    await expect(
      verifyCandidate(directory, { ...provenance, [field]: value }, publicKey),
    ).rejects.toThrow("provenance mismatch");
  }
  await expect(createCandidate(directory, provenance, publicKey)).rejects.toThrow();
});

test("missing, extra, modified and linked files cannot pass promotion", async () => {
  const { directory, publicKey } = await fixture();
  await createCandidate(directory, provenance, publicKey);
  const installer = join(directory, "Flecten-0.1.2-linux-x86_64.AppImage");
  const original = await readFile(installer);
  await writeFile(installer, "changed installer");
  await expect(verifyCandidate(directory, provenance, publicKey)).rejects.toThrow(
    "file set or SHA256",
  );
  await rm(installer);
  await expect(verifyCandidate(directory, provenance, publicKey)).rejects.toThrow(
    "file set or SHA256",
  );
  await writeFile(installer, original);
  const extra = join(directory, "extra.txt");
  await writeFile(extra, "extra");
  await expect(verifyCandidate(directory, provenance, publicKey)).rejects.toThrow(
    "file set or SHA256",
  );
  await rm(extra);
  await symlink(installer, extra);
  await expect(verifyCandidate(directory, provenance, publicKey)).rejects.toThrow("symbolic link");
});

test("readiness requires every native target and authentic update metadata", async () => {
  const { directory, publicKey } = await fixture();
  const intel = join(directory, "Flecten-0.1.2-mac-x64.dmg");
  const original = await readFile(intel);
  await rm(intel);
  await expect(createCandidate(directory, provenance, publicKey)).rejects.toThrow(
    "missing installer",
  );
  await writeFile(intel, original);
  const envelopePath = join(directory, "beta-mac.signed.json");
  const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
  envelope.signature = Buffer.alloc(64).toString("base64");
  await writeFile(envelopePath, JSON.stringify(envelope));
  await checksums(directory);
  await expect(createCandidate(directory, provenance, publicKey)).rejects.toThrow(
    "signature is invalid",
  );
});
