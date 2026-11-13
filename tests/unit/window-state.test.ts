import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Bounds = { x?: number; y?: number; width: number; height: number; maximized: boolean };
type Display = { workArea: { x: number; y: number; width: number; height: number } };

const { claimSingleInstance, focusWindow, preserveUserData, rememberBounds, restoredBounds } =
  require("../../shell/window-state.mjs") as {
    claimSingleInstance(app: unknown, onSecondLaunch: () => void, exempt: boolean): boolean;
    focusWindow(win: unknown): void;
    preserveUserData(app: unknown): void;
    rememberBounds(win: unknown, file: string): void;
    restoredBounds(file: string, displays: Display[]): Bounds;
  };

const screen: Display[] = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
const dirs: string[] = [];

function stateFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "liquid-window-"));
  dirs.push(dir);
  const file = join(dir, "window-state.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("Flecten keeps an existing Chromium profile and prefers its own profile when present", () => {
  const directory = mkdtempSync(join(tmpdir(), "flecten-profile-"));
  dirs.push(directory);
  const legacy = join(directory, "liquid-harness");
  mkdirSync(legacy);
  let name = "";
  let selected: string | undefined;
  const app = {
    setName(value: string) {
      name = value;
    },
    getPath: () => directory,
    setPath(_key: string, value: string) {
      selected = value;
    },
  };
  preserveUserData(app);
  expect(name).toBe("Flecten");
  expect(selected).toBe(legacy);
  mkdirSync(join(directory, "Flecten"));
  selected = undefined;
  preserveUserData(app);
  expect(selected).toBeUndefined();
});

describe("window bounds", () => {
  test("a first launch and a broken file open at the reference size", () => {
    expect(restoredBounds(stateFile(), screen)).toEqual({
      width: 1480,
      height: 940,
      maximized: false,
    });
    expect(restoredBounds(stateFile("{not json"), screen).width).toBe(1480);
    expect(restoredBounds(stateFile('{"width":"wide","height":900}'), screen).width).toBe(1480);
  });

  test("the window comes back where it was closed, never below the minimum size", () => {
    const file = stateFile('{"x":120,"y":60,"width":1300,"height":700,"maximized":true}');
    expect(restoredBounds(file, screen)).toEqual({
      x: 120,
      y: 60,
      width: 1300,
      height: 700,
      maximized: true,
    });
    const small = stateFile('{"x":10,"y":10,"width":400,"height":300}');
    expect(restoredBounds(small, screen)).toEqual({
      x: 10,
      y: 10,
      width: 1180,
      height: 640,
      maximized: false,
    });
  });

  test("a position on a disconnected display is dropped, the size stays", () => {
    const file = stateFile('{"x":2600,"y":100,"width":1400,"height":900}');
    expect(restoredBounds(file, screen)).toEqual({ width: 1400, height: 900, maximized: false });
    const second: Display = { workArea: { x: 1920, y: 0, width: 2560, height: 1440 } };
    expect(restoredBounds(file, [...screen, second]).x).toBe(2600);
  });

  test("closing saves the normal bounds and the maximized flag in one write", () => {
    const file = stateFile();
    const handlers = new Map<string, () => void>();
    const win = {
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      getNormalBounds: () => ({ x: 40, y: 30, width: 1500, height: 960 }),
      isMaximized: () => true,
    };
    rememberBounds(win, file);
    handlers.get("close")?.();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      x: 40,
      y: 30,
      width: 1500,
      height: 960,
      maximized: true,
    });
    expect(restoredBounds(file, screen)).toEqual({
      x: 40,
      y: 30,
      width: 1500,
      height: 960,
      maximized: true,
    });
  });
});

describe("single instance", () => {
  function fakeApp(locked: boolean) {
    const handlers = new Map<string, () => void>();
    let asked = 0;
    return {
      app: {
        requestSingleInstanceLock: () => {
          asked += 1;
          return locked;
        },
        on: (event: string, handler: () => void) => handlers.set(event, handler),
      },
      handlers,
      asked: () => asked,
    };
  }

  test("the second launch focuses the first window", () => {
    const first = fakeApp(true);
    let focused = 0;
    expect(claimSingleInstance(first.app, () => (focused += 1), false)).toBe(true);
    first.handlers.get("second-instance")?.();
    expect(focused).toBe(1);

    const second = fakeApp(false);
    expect(claimSingleInstance(second.app, () => undefined, false)).toBe(false);
    expect(second.handlers.size).toBe(0);
  });

  test("automated runs do not take the lock", () => {
    const run = fakeApp(false);
    expect(claimSingleInstance(run.app, () => undefined, true)).toBe(true);
    expect(run.asked()).toBe(0);
  });

  test("focus restores a minimized window and ignores a closed one", () => {
    const calls: string[] = [];
    const win = (minimized: boolean, destroyed = false) => ({
      isDestroyed: () => destroyed,
      isMinimized: () => minimized,
      restore: () => calls.push("restore"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
    });
    focusWindow(win(true));
    expect(calls).toEqual(["restore", "show", "focus"]);
    calls.length = 0;
    focusWindow(win(false, true));
    focusWindow(null);
    expect(calls).toEqual([]);
  });
});
