import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Resolve existing ancestors too, including OS aliases such as macOS /var and Windows junctions. */
export function canonicalPath(input: string): string {
  const path = resolve(input);
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}
