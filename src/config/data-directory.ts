import { lstatSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { sameProjectPath } from "../../shared/project-index.cjs";
import { canonicalPath } from "../util/canonical-path";

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Move existing data intact; old journal and installed-module paths keep resolving. */
export function migrateDataDirectory(root: string): void {
  const legacy = resolve(root, ".liquid");
  const current = join(resolve(root), ".flecten");
  if (!present(legacy)) {
    try {
      mkdirSync(current, { recursive: true });
      symlinkSync(process.platform === "win32" ? current : ".flecten", legacy, "junction");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Keep read-only startup working, just as lockProject's unlocked fallback does.
      // ponytail: legacy access needs symlinks; add versioned discovery if unsupported filesystems need it.
      if (["EACCES", "EPERM", "EROFS", "ENOTSUP", "ENOSYS"].includes(code ?? "")) return;
      if (code === "EEXIST" && sameProjectPath(canonicalPath(legacy), canonicalPath(current)))
        return;
      throw error;
    }
    return;
  }
  if (present(current)) {
    if (sameProjectPath(canonicalPath(legacy), canonicalPath(current))) return;
    throw new Error(
      `Both ${current} and ${legacy} contain data. Resolve the storage conflict before opening this project.`,
    );
  }
  if (!lstatSync(legacy).isDirectory())
    throw new Error(`Cannot migrate ${legacy}: expected a regular data directory.`);
  renameSync(legacy, current);
  try {
    symlinkSync(process.platform === "win32" ? current : ".flecten", legacy, "junction");
  } catch (error) {
    renameSync(current, legacy);
    throw error;
  }
}
