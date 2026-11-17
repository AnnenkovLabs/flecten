import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const { canonicalProjectPath, readProjectIndex, selectProject, removeProject } = createRequire(import.meta.url)("../shared/project-index.cjs");

/** The shell owns folder selection; project content remains in the sidecar. */
export function projectSelection(profile, initial, legacyCwd) {
  const scratch = join(profile, "projectless");
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  let selected;
  if (initial) selected = selectProject(profile, initial).selected;
  else if (existsSync(join(profile, "projects.json"))) selected = readProjectIndex(profile).selected;
  else {
    let previous = null;
    if (legacyCwd && existsSync(join(profile, "flecten.config.json"))) {
      try { previous = canonicalProjectPath(legacyCwd); }
      catch { /* An unavailable legacy folder opens without a project. */ }
    }
    // Persist an empty selection too, so a fresh profile cannot look like a legacy install later.
    selected = selectProject(profile, previous).selected;
  }
  if (selected) {
    try { canonicalProjectPath(selected); }
    catch { selected = selectProject(profile, null).selected; }
  }
  return {
    get cwd() { return selected ?? scratch; },
    get projectless() { return selected === null; },
    select(path) {
      selected = selectProject(profile, path).selected;
      return this.cwd;
    },
    remove(path) {
      const index = removeProject(profile, path);
      const changed = selected === path;
      if (changed) selected = index.selected;
      return changed;
    },
  };
}

export function registerProjectIpc({ ipcMain, dialog, BrowserWindow, isTrusted, selection, switchProject, refresh }) {
  ipcMain.handle("flecten:choose-project", async (event) => {
    if (!isTrusted(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    const selected = result.canceled ? undefined : result.filePaths[0];
    if (!selected) return null;
    return switchProject(selected);
  });
  ipcMain.handle("flecten:select-project", (event, path, sessionId) => {
    if (!isTrusted(event)) throw new Error("Untrusted window");
    if (path !== null && typeof path !== "string") throw new Error("Invalid project path");
    if (sessionId !== undefined && (typeof sessionId !== "string" || sessionId.length > 128)) throw new Error("Invalid session id");
    return switchProject(path, sessionId);
  });
  ipcMain.handle("flecten:remove-project", (event, path) => {
    if (!isTrusted(event) || typeof path !== "string") throw new Error("Invalid project path");
    if (selection.remove(path)) switchProject(null);
    else refresh();
  });
}
