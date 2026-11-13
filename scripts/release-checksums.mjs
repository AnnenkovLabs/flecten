import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkArtifactSize } from "./artifact-budget.mjs";
import { generateSbom } from "./sbom.mjs";

await generateSbom();

const releaseDir = resolve(import.meta.dir, "..", "release");
const skip = new Set(["SHA256SUMS.txt"]);
const files = readdirSync(releaseDir)
  .filter((name) => !skip.has(name))
  .map((name) => join(releaseDir, name))
  .filter((path) => statSync(path).isFile())
  .sort();

if (files.filter((path) => basename(path) !== "sbom.json").length === 0) {
  throw new Error("no release artifacts found");
}

const lines = [];
for (const path of files) {
  checkArtifactSize(basename(path), statSync(path).size);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${path.slice(releaseDir.length + 1)}`);
}

writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} checksums`);
