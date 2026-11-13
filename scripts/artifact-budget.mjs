import { extname } from "node:path";

// Electron runtime + Bun agent + editor assets. Raising this requires measured release evidence.
export const INSTALLER_BUDGET_BYTES = 350 * 1024 * 1024;
const INSTALLERS = new Set([".appimage", ".dmg", ".zip", ".exe"]);

export function checkArtifactSize(name, bytes) {
  if (!INSTALLERS.has(extname(name).toLowerCase())) return;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid artifact size: ${name}`);
  if (bytes > INSTALLER_BUDGET_BYTES) {
    throw new Error(
      `${name} is ${(bytes / 1024 / 1024).toFixed(1)} MiB, above the 350 MiB installer budget. Remove unused package inputs or document a measured budget change.`,
    );
  }
}
