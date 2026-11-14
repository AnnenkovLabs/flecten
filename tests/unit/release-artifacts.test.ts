import { afterEach, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mergeReleaseArtifacts } = require("../../scripts/merge-release-artifacts.mjs") as {
  mergeReleaseArtifacts(input: string, output: string, version: string): Promise<void>;
};
const { signUpdateManifests } = require("../../scripts/sign-update-manifests.mjs") as {
  signUpdateManifests(options: {
    directory: string;
    privateKey: string;
    publicKey: string;
    version: string;
  }): Promise<string[]>;
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "flecten-release-merge-"));
  roots.push(root);
  const input = join(root, "input");
  await mkdir(input);
  return { root, input, output: join(root, "release") };
}

async function nativeBuild(input: string, arch: string, version = "0.1.1") {
  const directory = join(input, `release-macos-${arch}`);
  await mkdir(directory);
  const files = [];
  for (const ext of ["zip", "dmg"]) {
    const url = `Flecten-${version}-mac-${arch}.${ext}`;
    const bytes = Buffer.from(`native ${arch} ${ext}`);
    await writeFile(join(directory, url), bytes);
    files.push({
      url,
      size: bytes.length,
      sha512: createHash("sha512").update(bytes).digest("base64"),
    });
  }
  const info = { version, files, path: files[0]?.url, sha512: files[0]?.sha512 };
  await writeFile(join(directory, "beta-mac.yml"), Bun.YAML.stringify(info));
  await writeFile(join(directory, "UNSIGNED-macos.txt"), `${arch}: no Developer ID certificate\n`);
  await writeFile(join(directory, `${files[0]?.url}.blockmap`), `block map ${arch}`);
  return { directory, info };
}

test("both native macOS builds, markers and blockmaps survive collection and signing", async () => {
  const { input, output } = await fixture();
  await nativeBuild(input, "arm64");
  await nativeBuild(input, "x64");
  await mergeReleaseArtifacts(input, output, "0.1.1");
  const metadata = Bun.YAML.parse(await readFile(join(output, "beta-mac.yml"), "utf8")) as {
    files: Array<{ url: string }>;
  };
  expect(metadata.files.map((file) => file.url)).toEqual([
    "Flecten-0.1.1-mac-arm64.zip",
    "Flecten-0.1.1-mac-arm64.dmg",
    "Flecten-0.1.1-mac-x64.zip",
    "Flecten-0.1.1-mac-x64.dmg",
  ]);
  const marker = await readFile(join(output, "UNSIGNED-macos.txt"), "utf8");
  expect(marker).toContain("arm64: no Developer ID certificate");
  expect(marker).toContain("x64: no Developer ID certificate");
  expect((await readdir(output)).filter((name) => name.endsWith(".blockmap"))).toHaveLength(2);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  expect(
    await signUpdateManifests({
      directory: output,
      version: "0.1.1",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }),
  ).toEqual([join(output, "beta-mac.signed.json")]);
});

test("conflicting metadata and mixed versions fail before creating release output", async () => {
  const { input, output, root } = await fixture();
  const arm = await nativeBuild(input, "arm64");
  const intel = await nativeBuild(input, "x64");
  const conflict = {
    ...arm.info,
    files: arm.info.files.map((file) => ({ ...file, size: file.size + 1 })),
  };
  await writeFile(join(intel.directory, "beta-mac.yml"), Bun.YAML.stringify(conflict));
  await expect(mergeReleaseArtifacts(input, output, "0.1.1")).rejects.toThrow(
    "Conflicting update artifact",
  );
  expect(await readdir(root)).not.toContain("release");
  await writeFile(
    join(intel.directory, "beta-mac.yml"),
    Bun.YAML.stringify({ ...intel.info, version: "0.1.0" }),
  );
  await expect(mergeReleaseArtifacts(input, output, "0.1.1")).rejects.toThrow(
    "Release version mismatch",
  );
  expect(await readdir(root)).not.toContain("release");
});

test("existing output and duplicate installers are never overwritten", async () => {
  const { input, output } = await fixture();
  const arm = await nativeBuild(input, "arm64");
  await mkdir(output);
  await writeFile(join(output, "operator.txt"), "keep existing artifacts");
  await expect(mergeReleaseArtifacts(input, output, "0.1.1")).rejects.toThrow();
  expect(await readFile(join(output, "operator.txt"), "utf8")).toBe("keep existing artifacts");
  const other = join(input, "release-other");
  await mkdir(other);
  await writeFile(join(other, arm.info.files[0]?.url ?? ""), "unexpected duplicate");
  await expect(mergeReleaseArtifacts(input, join(output, "new"), "0.1.1")).rejects.toThrow(
    "Duplicate release artifact",
  );
});
