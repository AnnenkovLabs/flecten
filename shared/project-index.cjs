const {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { basename, dirname, isAbsolute, join, resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { z } = require("zod");

const projectSchema = z.object({
  path: z.string().min(1).refine(isAbsolute),
  name: z.string().min(1),
  trust: z.enum(["unknown", "trusted", "untrusted"]),
});
const indexSchema = z.object({
  version: z.literal(1),
  selected: z.string().nullable(),
  projects: z.array(projectSchema),
});

function canonicalProjectPath(path) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw new Error("Project path must be absolute");
  const canonical = realpathSync(resolve(path));
  if (!statSync(canonical).isDirectory()) throw new Error("Project path must be a directory");
  return canonical;
}

function readProjectIndex(profile) {
  try {
    return indexSchema.parse(JSON.parse(readFileSync(join(profile, "projects.json"), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, selected: null, projects: [] };
    throw new Error("Cannot read the project index. Restore projects.json from a backup.", {
      cause: error,
    });
  }
}

function saveProjectIndex(profile, index) {
  const parsed = indexSchema.parse(index);
  const created = mkdirSync(profile, { recursive: true, mode: 0o700 });
  if (created) {
    const boundary = dirname(resolve(created));
    for (let directory = resolve(profile); ; directory = dirname(directory)) {
      syncPath(directory, true);
      if (directory === boundary) break;
    }
  }
  const path = join(profile, "projects.json");
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    syncPath(temp, false);
    renameSync(temp, path);
    syncPath(profile, true);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return parsed;
}

function syncPath(path, directory) {
  try {
    const handle = openSync(path, "r");
    try {
      try {
        fsyncSync(handle);
      } catch (error) {
        if (directory && process.platform === "win32" && error.code === "EPERM") return;
        throw error;
      }
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    // ponytail: unsupported Windows directory sync keeps file durability; verify names on reopen.
    if (
      directory &&
      process.platform === "win32" &&
      ["EISDIR", "EINVAL", "ENOTSUP", "ENOSYS"].includes(error.code)
    )
      return;
    throw error;
  }
}

function selectProject(profile, path) {
  const index = readProjectIndex(profile);
  const canonical = path === null ? null : canonicalProjectPath(path);
  if (canonical && !index.projects.some((project) => project.path === canonical)) {
    index.projects.push({
      path: canonical,
      name: basename(canonical) || canonical,
      trust: "unknown",
    });
  }
  index.selected = canonical;
  return saveProjectIndex(profile, index);
}

function removeProject(profile, path) {
  const index = readProjectIndex(profile);
  index.projects = index.projects.filter((project) => project.path !== path);
  if (index.selected === path) index.selected = null;
  return saveProjectIndex(profile, index);
}

function setProjectTrust(profile, path, trust) {
  const decision = projectSchema.shape.trust.parse(trust);
  const canonical = canonicalProjectPath(path);
  const index = readProjectIndex(profile);
  const project = index.projects.find((item) => item.path === canonical);
  if (project) project.trust = decision;
  else
    index.projects.push({
      path: canonical,
      name: basename(canonical) || canonical,
      trust: decision,
    });
  return saveProjectIndex(profile, index);
}

module.exports = {
  canonicalProjectPath,
  readProjectIndex,
  selectProject,
  removeProject,
  setProjectTrust,
};
