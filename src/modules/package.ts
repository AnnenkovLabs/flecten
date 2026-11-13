import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type ModuleManifest, ModuleManifestSchema } from "./manifest";

export interface ModulePackage {
  path: string;
  revision: string;
  manifest: ModuleManifest;
  files: ReadonlyMap<string, Uint8Array>;
}
const MANIFEST = ".flecten-module/module.json";

/** A generation contains the exact bytes reviewed, including executable code. No symlinks. */
export async function readModule(path: string): Promise<ModulePackage> {
  const root = resolve(path);
  if (!(await lstat(root)).isDirectory()) throw new Error("Module must be a directory");
  const files = new Map<string, Uint8Array>();
  const hash = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  let count = 0;
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (++count > 5000) throw new Error("Module exceeds 5000 entries");
      const target = join(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new Error("Module resources must be regular files and directories");
      if (info.isDirectory()) {
        await walk(target);
        continue;
      }
      bytes += info.size;
      if (bytes > 32 * 1024 * 1024)
        throw new Error("Module exceeds 32 MiB; keep dependencies outside the package");
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let content: Uint8Array;
      try {
        const actual = await handle.stat();
        if (!actual.isFile() || actual.size !== info.size || actual.ino !== info.ino)
          throw new Error("Module changed while being read; retry loading");
        content = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (content.byteLength !== info.size)
        throw new Error("Module changed while being read; retry loading");
      const local = relative(root, target).split(sep).join("/");
      files.set(local, content);
      hash.update(local);
      hash.update("\0");
      hash.update(content);
      hash.update("\0");
    }
  }
  await walk(root);
  const raw = files.get(MANIFEST);
  if (!raw || raw.byteLength > 128 * 1024) throw new Error(`Missing or oversized ${MANIFEST}`);
  const manifest = ModuleManifestSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  for (const path of [
    ...manifest.instructions,
    ...manifest.styles,
    ...manifest.resources.map((r) => r.path),
    ...manifest.surfaces.map((s) => s.entry),
    ...(manifest.runtime ? [manifest.runtime.entry] : []),
    ...(manifest.platform ? [manifest.platform.entry] : []),
  ]) {
    if (!files.has(path)) throw new Error(`Missing module resource: ${path}`);
  }
  return { path: root, revision: hash.digest("hex"), manifest, files };
}

export function moduleText(module: ModulePackage, path: string, limit = 64_000): string {
  const bytes = module.files.get(path);
  if (!bytes || bytes.byteLength > limit)
    throw new Error(`Module resource is missing or exceeds ${limit} bytes: ${path}`);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function writeModuleFiles(root: string, module: ModulePackage): Promise<void> {
  // Publish the manifest last: discovery cannot activate a partially copied package.
  const files = [...module.files].sort(
    ([a], [b]) => Number(a === MANIFEST) - Number(b === MANIFEST),
  );
  for (const [path, content] of files) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600 });
  }
}

/** Private immutable source generation; a source edit cannot change an in-flight process. */
export async function materializeModule(cwd: string, module: ModulePackage) {
  const parent = join(cwd, ".liquid", "module-runtime");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, `${module.manifest.name}-`));
  try {
    await writeModuleFiles(root, module);
    return { root, close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function installModule(cwd: string, source: string): Promise<string> {
  const module = await readModule(resolve(cwd, source));
  const target = join(cwd, ".liquid", "modules", module.manifest.name);
  const origin = await realpath(module.path);
  if (target === origin || target.startsWith(`${origin}${sep}`))
    throw new Error("Install destination is inside its source");
  return publishModule(cwd, module);
}

export async function publishModule(cwd: string, module: ModulePackage): Promise<string> {
  const target = join(cwd, ".liquid", "modules", module.manifest.name);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target, { mode: 0o700 });
  try {
    await writeModuleFiles(target, module);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}
