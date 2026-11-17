import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

function canonicalSocketPath(path: string): string | undefined {
  for (let remaining = 40; remaining > 0; remaining--) {
    const parent = realpathSync.native(dirname(path));
    const candidate = join(parent, basename(path));
    const info = lstatSync(candidate);
    if (info.isSocket()) return candidate;
    if (!info.isSymbolicLink()) return undefined;
    const target = readlinkSync(candidate);
    path = isAbsolute(target) ? target : `${parent}${sep}${target}`;
  }
  return undefined;
}

/** Resolve an existing path, including Unix sockets on Bun 1.4.2 for macOS. */
export function canonicalExistingPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    // Darwin refuses to open a socket as a file. Resolve its name without opening it.
    if (process.platform === "darwin" && (error as NodeJS.ErrnoException).code === "EOPNOTSUPP") {
      const socket = canonicalSocketPath(path);
      if (socket) return socket;
    }
    throw error;
  }
}

/** Resolve existing ancestors too, including OS aliases such as macOS /var and Windows junctions. */
export function canonicalPath(input: string): string {
  const path = resolve(input);
  try {
    // The native resolver expands Windows 8.3 aliases just like async realpath.
    return realpathSync.native(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}
