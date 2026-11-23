export type ProjectTrust = "unknown" | "trusted" | "untrusted";
export interface RememberedProject {
  path: string;
  name: string;
  trust: ProjectTrust;
}
export interface ProjectIndex {
  version: 1;
  selected: string | null;
  projects: RememberedProject[];
}
export function canonicalProjectPath(path: string): string;
export function sameProjectPath(
  left: string | null | undefined,
  right: string | null | undefined,
  platform?: NodeJS.Platform,
): boolean;
export function readProjectIndex(profile: string): ProjectIndex;
export function selectProject(profile: string, path: string | null): ProjectIndex;
export function removeProject(profile: string, path: string): ProjectIndex;
export function setProjectTrust(profile: string, path: string, trust: ProjectTrust): ProjectIndex;
