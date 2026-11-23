import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  APPEARANCE_STORAGE_KEY,
  appearance,
  applyAppearance,
  CHAT_WIDTH,
  CODE_FONT_SIZE,
  IDE_LAYOUT_STORAGE_KEY,
  initializeAppearance,
  isAppearanceCustomized,
  resetAppearance,
  SUMMARY_SCALE,
  setChatWidth,
  setCodeFontSize,
  setSummaryScale,
  setTerminalFontSize,
  setTextScale,
  TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STORAGE_KEY,
  TEXT_SCALE,
} from "../../ui/src/lib/appearance.svelte";
import { setLocale } from "../../ui/src/lib/i18n.svelte";
import { IdeLayout } from "../../ui/src/lib/ide/layout.svelte";
import { searchSettingsSections } from "../../ui/src/lib/settings/sections";
import { TerminalStore } from "../../ui/src/lib/terminal/store.svelte";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function createFakeRoot(): { root: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>();
  const root = {
    style: {
      setProperty(name: string, value: string) {
        props.set(name, value);
      },
      removeProperty(name: string) {
        props.delete(name);
        return "";
      },
    },
  } as unknown as HTMLElement;
  return { root, props };
}

describe("appearance settings", () => {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    const listeners = new Set<EventListener>();
    Object.defineProperty(globalThis, "window", {
      value: {
        addEventListener(_type: string, listener: EventListener) {
          listeners.add(listener);
        },
        removeEventListener(_type: string, listener: EventListener) {
          listeners.delete(listener);
        },
      },
      configurable: true,
      writable: true,
    });
    resetAppearance();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  test("applies, persists, validates, and resets all appearance size controls", () => {
    const { root, props } = createFakeRoot();
    expect(isAppearanceCustomized()).toBe(false);
    applyAppearance(root);
    expect(props.size).toBe(0);

    setTextScale(120);
    setSummaryScale(130);
    setChatWidth(940);
    setCodeFontSize(16);
    setTerminalFontSize(15);

    expect(isAppearanceCustomized()).toBe(true);
    expect(appearance.textScale).toBe(120);
    expect(appearance.summaryScale).toBe(130);
    expect(appearance.chatWidth).toBe(940);
    expect(appearance.codeFontSize).toBe(16);
    expect(appearance.terminalFontSize).toBe(15);

    applyAppearance(root);
    expect(props.get("--text-scale")).toBe("1.2");
    expect(props.get("--content-w")).toBe("940px");
    expect(props.get("--code-font-size")).toBe("16px");

    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toEqual({
      textScale: 120,
      summaryScale: 130,
      chatWidth: 940,
    });
    expect(JSON.parse(localStorage.getItem(IDE_LAYOUT_STORAGE_KEY) ?? "{}").fontSize).toBe(16);
    expect(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)).toBe("15");

    // Reject out-of-range and off-step values without mutating valid state.
    for (const invalid of [0, 74, 155, 102, Number.NaN, "120", null]) {
      setTextScale(invalid);
      setSummaryScale(invalid);
    }
    for (const invalid of [600, 625, 1140, Number.NaN, "900"]) {
      setChatWidth(invalid);
    }
    for (const invalid of [10, 23, 13.5, Number.NaN, "14"]) {
      setCodeFontSize(invalid);
    }
    for (const invalid of [9, 23, 13.5, Number.NaN, "14"]) {
      setTerminalFontSize(invalid);
    }

    expect(appearance.textScale).toBe(120);
    expect(appearance.summaryScale).toBe(130);
    expect(appearance.chatWidth).toBe(940);
    expect(appearance.codeFontSize).toBe(16);
    expect(appearance.terminalFontSize).toBe(15);

    resetAppearance();
    applyAppearance(root);
    expect(isAppearanceCustomized()).toBe(false);
    expect(appearance).toEqual({
      textScale: TEXT_SCALE.default,
      summaryScale: SUMMARY_SCALE.default,
      chatWidth: CHAT_WIDTH.default,
      codeFontSize: CODE_FONT_SIZE.default,
      terminalFontSize: TERMINAL_FONT_SIZE.default,
    });
    expect(props.size).toBe(0);
  });

  test("restores valid persisted fields and falls back per field on corruption", () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ textScale: 115, summaryScale: 999, chatWidth: 860 }),
    );
    localStorage.setItem(
      IDE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        filesWidth: 260,
        agentWidth: 380,
        outputHeight: 240,
        fontSize: 15,
        tabSize: 4,
        wrap: true,
        minimap: false,
      }),
    );
    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, "17");

    const release = initializeAppearance();
    try {
      expect(appearance.textScale).toBe(115);
      expect(appearance.summaryScale).toBe(SUMMARY_SCALE.default);
      expect(appearance.chatWidth).toBe(860);
      expect(appearance.codeFontSize).toBe(15);
      expect(appearance.terminalFontSize).toBe(17);

      setCodeFontSize(18);
      const savedLayout = JSON.parse(localStorage.getItem(IDE_LAYOUT_STORAGE_KEY) ?? "{}");
      expect(savedLayout.fontSize).toBe(18);
      expect(savedLayout.wrap).toBe(true);
      expect(savedLayout.tabSize).toBe(4);
    } finally {
      release();
    }
  });

  test("stays synchronized with IdeLayout and TerminalStore", () => {
    const ideLayout = new IdeLayout();
    const terminals = new TerminalStore();

    setCodeFontSize(17);
    expect(ideLayout.values.fontSize).toBe(17);

    ideLayout.set({ fontSize: 14, wrap: true });
    expect(appearance.codeFontSize).toBe(14);
    expect(ideLayout.values.wrap).toBe(true);

    setTerminalFontSize(16);
    expect(terminals.fontSize).toBe(16);

    terminals.zoom(-2);
    expect(appearance.terminalFontSize).toBe(14);
  });

  test("places Appearance as its own searchable section and moves Interface scale out of General", () => {
    setLocale("en");
    const scaleMatches = searchSettingsSections("Interface scale").map((section) => section.id);
    expect(scaleMatches).toEqual(["appearance"]);

    const summaryMatches = searchSettingsSections("HTML summary").map((section) => section.id);
    expect(summaryMatches).toEqual(["appearance"]);

    setLocale("ru");
    const ruMatches = searchSettingsSections("Внешний вид").map((section) => section.id);
    expect(ruMatches).toEqual(["appearance"]);
    setLocale("en");
  });
});
