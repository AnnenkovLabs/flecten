import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export async function createFixture(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-bench-"));
  for (const path of Object.keys(files).sort()) {
    const full = resolve(cwd, path);
    if (!full.startsWith(`${cwd}${sep}`)) throw new Error(`fixture path escapes: ${path}`);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, files[path] ?? "");
  }
  return cwd;
}
