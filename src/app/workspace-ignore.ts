/**
 * Standard non-source directories, binary extensions, and generated/lock files
 * excluded from workspace indexing and code search.
 */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "release",
  "coverage",
  ".flecten",
  ".liquid",
  ".flecten-migration",
  ".flecten-scratch",
  ".kilo",
  ".commandcode",
  ".cache",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".svelte-check",
  ".turbo",
  ".vite",
  ".parcel-cache",
  ".output",
  ".vercel",
  ".netlify",
  ".gradle",
  ".mvn",
  ".idea",
  ".vscode-test",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".eggs",
  "vendor",
  "bower_components",
  ".yarn",
  ".pnpm-store",
  "Pods",
  "DerivedData",
  "playwright-report",
  "test-results",
  ".nyc_output",
  "htmlcov",
]);

export const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "icns",
  "bmp",
  "tif",
  "tiff",
  "psd",
  "ai",
  "eps",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "aac",
  "m4a",
  "opus",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "wmv",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "zst",
  "br",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "appimage",
  "msi",
  "exe",
  "dll",
  "so",
  "dylib",
  "a",
  "o",
  "obj",
  "lib",
  "pdb",
  "class",
  "jar",
  "war",
  "ear",
  "pyc",
  "pyo",
  "pyd",
  "wasm",
  "node",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "sqlite",
  "sqlite3",
  "db",
  "db-wal",
  "db-shm",
  "bin",
  "dat",
  "pack",
  "idx",
  "lockb",
  "DS_Store",
]);

export const SEARCH_IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  "flake.lock",
  ".ds_store",
  "thumbs.db",
]);

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(slash + 1);
}

export function isIgnoredPath(path: string): boolean {
  for (const part of path.split("/")) {
    if (IGNORED_DIRECTORIES.has(part)) return true;
  }
  return false;
}

export function isBinaryExtension(path: string): boolean {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Skip binary, lockfile, source-map, and minified assets during workspace code search. */
export function isExcludedFromSearch(path: string): boolean {
  if (isIgnoredPath(path) || isBinaryExtension(path)) return true;
  const lower = baseName(path).toLowerCase();
  if (SEARCH_IGNORED_FILES.has(lower)) return true;
  return (
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css") ||
    lower.endsWith(".js.map") ||
    lower.endsWith(".css.map") ||
    lower.endsWith(".d.ts.map")
  );
}
