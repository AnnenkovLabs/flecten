import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readProjectIndex,
  removeProject,
  selectProject,
  setProjectTrust,
} from "../../shared/project-index.cjs";

const { projectSelection } = require("../../shell/projects.mjs") as {
  projectSelection(
    profile: string,
    initial?: string,
    legacyCwd?: string,
  ): { cwd: string; projectless: boolean };
};

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "flecten-project-index-"));
  directories.push(root);
  const profile = join(root, "profile");
  const project = join(root, "work");
  await mkdir(project);
  return { root, profile, project };
}

test("a fresh desktop records no project before creating its global config", async () => {
  const { profile, project } = await fixture();
  const selection = projectSelection(profile, undefined, project);
  expect(selection.projectless).toBe(true);
  expect(selection.cwd).toBe(join(profile, "projectless"));
  expect(existsSync(join(profile, "projects.json"))).toBe(true);
  expect(readProjectIndex(profile)).toEqual({ version: 1, selected: null, projects: [] });
  await Bun.write(join(profile, "flecten.config.json"), "{}");
  expect(projectSelection(profile, undefined, project).projectless).toBe(true);
  expect(readProjectIndex(profile)).toEqual({ version: 1, selected: null, projects: [] });
});

test("a legacy profile retains its startup directory with unknown trust", async () => {
  const { profile, project } = await fixture();
  await Bun.write(join(profile, "flecten.config.json"), "{}");
  const selection = projectSelection(profile, undefined, project);
  expect(selection.projectless).toBe(false);
  expect(selection.cwd).toBe(project);
  expect(readProjectIndex(profile)).toEqual({
    version: 1,
    selected: project,
    projects: [{ path: project, name: "work", trust: "unknown" }],
  });
});

test("an unavailable legacy startup directory falls back without recreating it", async () => {
  const { profile, project } = await fixture();
  await Bun.write(join(profile, "flecten.config.json"), "{}");
  await rm(project, { recursive: true });
  const selection = projectSelection(profile, undefined, project);
  expect(selection.projectless).toBe(true);
  expect(selection.cwd).toBe(join(profile, "projectless"));
  expect(readProjectIndex(profile)).toEqual({ version: 1, selected: null, projects: [] });
  expect(existsSync(project)).toBe(false);
});

test("canonical project trust and selection survive reopening; removing preserves folder data", async () => {
  const { root, profile, project } = await fixture();
  const alias = join(root, "alias");
  await symlink(project, alias, "dir");
  selectProject(profile, alias);
  setProjectTrust(profile, project, "untrusted");
  expect(projectSelection(profile).cwd).toBe(project);
  expect(readProjectIndex(profile).projects).toEqual([
    { path: project, name: "work", trust: "untrusted" },
  ]);
  setProjectTrust(profile, alias, "trusted");
  expect(readProjectIndex(profile).projects[0]?.trust).toBe("trusted");
  removeProject(profile, project);
  expect(readProjectIndex(profile)).toEqual({ version: 1, selected: null, projects: [] });
  expect(existsSync(project)).toBe(true);
});

test("a missing selected folder falls back without recreating it or forgetting it", async () => {
  const { profile, project } = await fixture();
  selectProject(profile, project);
  await rm(project, { recursive: true });
  const selection = projectSelection(profile);
  expect(selection.projectless).toBe(true);
  expect(readProjectIndex(profile).projects[0]?.path).toBe(project);
  expect(existsSync(project)).toBe(false);
});
