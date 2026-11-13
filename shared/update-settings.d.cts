export type UpdateChannel = "stable" | "beta";

export interface GithubRepo {
  owner: string;
  repo: string;
}

export interface UpdateSettings {
  channel: UpdateChannel;
  feedUrl?: string;
  github?: GithubRepo;
  autoCheck: boolean;
  autoDownload: boolean;
  installOnQuit: boolean;
}

export const UPDATE_CHANNELS: readonly ["stable", "beta"];
export const UPDATE_DEFAULTS: Readonly<UpdateSettings>;
export function isGithubName(value: unknown): boolean;
export function normalizeUpdateSettings(value: unknown): UpdateSettings;
