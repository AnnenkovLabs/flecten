import { dirname } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import {
  canonicalProjectPath,
  type ProjectTrust,
  readProjectIndex,
  sameProjectPath,
  setProjectTrust,
} from "../../shared/project-index.cjs";
import { configPath } from "../config/load";

function profileDirectory(cwd: string): string {
  return productEnv("PROFILE")?.trim() || dirname(configPath(cwd));
}

/** Trust belongs to the canonical directory and survives reopening the application. */
export function projectTrust(cwd: string, projectRoot: string | null): ProjectTrust {
  if (projectRoot === null) return "trusted";
  const path = canonicalProjectPath(projectRoot);
  return (
    readProjectIndex(profileDirectory(cwd)).projects.find((project) =>
      sameProjectPath(project.path, path),
    )?.trust ?? "unknown"
  );
}

export function saveProjectTrust(
  cwd: string,
  projectRoot: string,
  trust: Exclude<ProjectTrust, "unknown">,
): void {
  setProjectTrust(profileDirectory(cwd), projectRoot, trust);
}
