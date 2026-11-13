// One app per user profile and a window that opens where it was closed.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Keep Chromium preferences and the single-instance lock in an existing profile. */
export function preserveUserData(app) {
  app.setName("Flecten");
  const directory = app.getPath("appData");
  const preferred = join(directory, "Flecten");
  if (existsSync(preferred)) return;
  const legacy = ["liquid-harness", "Liquid Harness"].map((name) => join(directory, name));
  const existing = legacy.find((path) => existsSync(path));
  if (existing) app.setPath("userData", existing);
}

export const DEFAULT_BOUNDS = Object.freeze({ width: 1480, height: 940 });
export const MIN_SIZE = Object.freeze({ width: 1180, height: 640 });
/** How much of the window must stay on a display to keep its saved position. */
const MIN_VISIBLE = 64;

/**
 * A second launch focuses the first window instead of starting a second sidecar over the same
 * config and sessions. Headless test, smoke and screenshot runs are exempt: they start and stop
 * apps back to back. Returns false when this process has to quit.
 */
export function claimSingleInstance(app, onSecondLaunch, exempt) {
  if (exempt) return true;
  if (!app.requestSingleInstanceLock()) return false;
  app.on("second-instance", () => onSecondLaunch());
  return true;
}

export function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function overlap(start, size, areaStart, areaSize) {
  return Math.min(start + size, areaStart + areaSize) - Math.max(start, areaStart);
}

function visibleOn(bounds, display) {
  const area = display.workArea;
  return (
    overlap(bounds.x, bounds.width, area.x, area.width) >= MIN_VISIBLE &&
    overlap(bounds.y, bounds.height, area.y, area.height) >= MIN_VISIBLE
  );
}

/**
 * Bounds saved at the last close. A position is kept only while a connected display still shows
 * the window; otherwise the window keeps its size and the system centers it.
 */
export function restoredBounds(file, displays) {
  let saved;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ...DEFAULT_BOUNDS, maximized: false };
  }
  if (saved === null || typeof saved !== "object" || !isInteger(saved.width)) {
    return { ...DEFAULT_BOUNDS, maximized: false };
  }
  if (!isInteger(saved.height)) return { ...DEFAULT_BOUNDS, maximized: false };
  const size = {
    width: Math.max(MIN_SIZE.width, saved.width),
    height: Math.max(MIN_SIZE.height, saved.height),
  };
  const maximized = saved.maximized === true;
  if (!isInteger(saved.x) || !isInteger(saved.y)) return { ...size, maximized };
  const bounds = { x: saved.x, y: saved.y, ...size };
  return displays.some((display) => visibleOn(bounds, display))
    ? { ...bounds, maximized }
    : { ...size, maximized };
}

/** Saves the normal (not maximized) bounds when the window closes; a temp file and a rename keep it whole. */
export function rememberBounds(win, file) {
  win.on("close", () => {
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      writeFileSync(`${file}.tmp`, `${JSON.stringify(state)}\n`);
      renameSync(`${file}.tmp`, file);
    } catch {
      // ponytail: a read-only profile keeps the default size next time; nothing else depends on it.
    }
  });
}
