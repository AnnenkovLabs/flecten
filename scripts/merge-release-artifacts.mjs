import { constants } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactName, validatedUpdateInfo } from "../shell/update-signature.mjs";

function combineMetadata(previous, next, name) {
  const files = new Map(previous.files.map((file) => [file.url, file]));
  for (const file of next.files) {
    const existing = files.get(file.url);
    if (existing && JSON.stringify(existing) !== JSON.stringify(file))
      throw new Error(`Conflicting update artifact in ${name}: ${file.url}`);
    files.set(file.url, file);
  }
  return { ...previous, files: [...files.values()] };
}

/** Collect native build outputs without overwriting files from another architecture. */
export async function mergeReleaseArtifacts(input, output, version) {
  if (typeof version !== "string" || !version) throw new Error("Release version is required.");
  const files = new Map();
  const sources = await readdir(input, { withFileTypes: true });
  sources.sort((a, b) => a.name.localeCompare(b.name));
  for (const source of sources) {
    if (!source.isDirectory()) throw new Error("Release input must contain artifact directories.");
    const directory = join(input, source.name);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error("Release artifacts must be regular files.");
      const name = artifactName(entry.name);
      const path = join(directory, name);
      const previous = files.get(name);
      if (extname(name) === ".yml") {
        const metadata = Bun.YAML.parse(await readFile(path, "utf8"));
        const validated = validatedUpdateInfo(metadata);
        if (validated.version !== version) throw new Error(`Release version mismatch: ${name}`);
        files.set(name, {
          metadata: previous ? combineMetadata(previous.metadata, metadata, name) : metadata,
        });
      } else if (name.startsWith("UNSIGNED-") && extname(name) === ".txt") {
        const text = `Build: ${source.name}\n${await readFile(path, "utf8")}\n`;
        files.set(name, { text: (previous?.text ?? "") + text });
      } else {
        if (previous) throw new Error(`Duplicate release artifact: ${name}`);
        files.set(name, { path });
      }
    }
  }
  if (!files.size) throw new Error("No release artifacts found.");
  await mkdir(output);
  for (const [name, file] of files) {
    const target = join(output, name);
    if (file.metadata) await writeFile(target, Bun.YAML.stringify(file.metadata), { flag: "wx" });
    else if (file.text !== undefined) await writeFile(target, file.text, { flag: "wx" });
    else await copyFile(file.path, target, constants.COPYFILE_EXCL);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: merge-release-artifacts.mjs <input> <output>");
  const { version } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  await mergeReleaseArtifacts(resolve(input), resolve(output), version);
}
