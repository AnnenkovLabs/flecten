import { stat } from "node:fs/promises";
import { join } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import { readProjectIndex } from "../../shared/project-index.cjs";
import { listSessions } from "../store/events/index";
import type { AppService } from "./service-types";

/** Only remembered folders are inspected; no filesystem-wide session discovery. */
export async function projectList(app: AppService) {
  const profile = productEnv("PROFILE")?.trim();
  const info = app.info();
  const remembered = profile ? readProjectIndex(profile).projects : [];
  const roots = [...remembered.map((project) => ({ ...project, projectRoot: project.path }))];
  const projects = await Promise.all(
    roots.map(async (project) => {
      try {
        if (!(await stat(project.path)).isDirectory())
          throw new Error("Select the folder again to restore access.");
        const sessions =
          project.path === info.cwd ? await app.listSessions() : await listSessions(project.path);
        return { ...project, sessions };
      } catch (error) {
        return {
          ...project,
          sessions: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const scratch = profile ? join(profile, "projectless") : info.cwd;
  const sessions =
    info.projectRoot === null
      ? await app.listSessions()
      : profile
        ? await listSessions(scratch)
        : [];
  return [
    ...projects,
    { path: scratch, projectRoot: null, name: "", trust: "trusted" as const, sessions },
  ];
}
