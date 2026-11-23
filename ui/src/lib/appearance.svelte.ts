import { z } from "zod";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "./terminal/xterm-config";

export const APPEARANCE_STORAGE_KEY = "flecten.appearance";
export const IDE_LAYOUT_STORAGE_KEY = "flecten.ide.layout";
export const TERMINAL_FONT_SIZE_STORAGE_KEY = "flecten.terminal.font-size";

export const TEXT_SCALE = { min: 75, max: 150, step: 5, default: 100 } as const;
export const SUMMARY_SCALE = { min: 75, max: 150, step: 5, default: 100 } as const;
export const CHAT_WIDTH = { min: 620, max: 1120, step: 20, default: 780 } as const;
export const CODE_FONT_SIZE = { min: 11, max: 22, step: 1, default: 13 } as const;
export const TERMINAL_FONT_SIZE = {
  min: MIN_TERMINAL_FONT_SIZE,
  max: MAX_TERMINAL_FONT_SIZE,
  step: 1,
  default: DEFAULT_TERMINAL_FONT_SIZE,
} as const;

const TextScaleSchema = z
  .number()
  .int()
  .min(TEXT_SCALE.min)
  .max(TEXT_SCALE.max)
  .multipleOf(TEXT_SCALE.step);

const SummaryScaleSchema = z
  .number()
  .int()
  .min(SUMMARY_SCALE.min)
  .max(SUMMARY_SCALE.max)
  .multipleOf(SUMMARY_SCALE.step);

const ChatWidthSchema = z
  .number()
  .int()
  .min(CHAT_WIDTH.min)
  .max(CHAT_WIDTH.max)
  .multipleOf(CHAT_WIDTH.step);

const CodeFontSizeSchema = z.number().int().min(CODE_FONT_SIZE.min).max(CODE_FONT_SIZE.max);

const TerminalFontSizeSchema = z
  .number()
  .int()
  .min(TERMINAL_FONT_SIZE.min)
  .max(TERMINAL_FONT_SIZE.max);

const DEFAULT_IDE_LAYOUT = {
  filesWidth: 240,
  agentWidth: 360,
  outputHeight: 220,
  fontSize: CODE_FONT_SIZE.default,
  tabSize: 2,
  wrap: false,
  minimap: true,
} as const;

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // A blocked profile store still allows adjusting appearance in the current window.
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupted preference entries fall back to defaults.
  }
  return null;
}

function parseAppearanceRecord(raw: string | null): {
  textScale: number;
  summaryScale: number;
  chatWidth: number;
} {
  const data = parseJsonObject(raw);
  const textScale = TextScaleSchema.safeParse(data?.textScale);
  const summaryScale = SummaryScaleSchema.safeParse(data?.summaryScale);
  const chatWidth = ChatWidthSchema.safeParse(data?.chatWidth);
  return {
    textScale: textScale.success ? textScale.data : TEXT_SCALE.default,
    summaryScale: summaryScale.success ? summaryScale.data : SUMMARY_SCALE.default,
    chatWidth: chatWidth.success ? chatWidth.data : CHAT_WIDTH.default,
  };
}

function parseCodeFontSize(raw: string | null): number {
  const data = parseJsonObject(raw);
  const parsed = CodeFontSizeSchema.safeParse(data?.fontSize);
  return parsed.success ? parsed.data : CODE_FONT_SIZE.default;
}

function parseTerminalFontSize(raw: string | null): number {
  if (!raw || raw.trim().length === 0) return TERMINAL_FONT_SIZE.default;
  const parsed = TerminalFontSizeSchema.safeParse(Number(raw));
  return parsed.success ? parsed.data : TERMINAL_FONT_SIZE.default;
}

function initialAppearance() {
  return {
    ...parseAppearanceRecord(readStorage(APPEARANCE_STORAGE_KEY)),
    codeFontSize: parseCodeFontSize(readStorage(IDE_LAYOUT_STORAGE_KEY)),
    terminalFontSize: parseTerminalFontSize(readStorage(TERMINAL_FONT_SIZE_STORAGE_KEY)),
  };
}

export const appearance = $state(initialAppearance());

function persistAppearanceRecord(): void {
  writeStorage(
    APPEARANCE_STORAGE_KEY,
    JSON.stringify({
      textScale: appearance.textScale,
      summaryScale: appearance.summaryScale,
      chatWidth: appearance.chatWidth,
    }),
  );
}

function persistCodeFontSize(fontSize: number): void {
  const existing = parseJsonObject(readStorage(IDE_LAYOUT_STORAGE_KEY));
  const next = { ...DEFAULT_IDE_LAYOUT, ...(existing ?? {}), fontSize };
  writeStorage(IDE_LAYOUT_STORAGE_KEY, JSON.stringify(next));
}

export function applyAppearance(root?: HTMLElement | null): void {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;

  if (appearance.textScale === TEXT_SCALE.default) {
    target.style.removeProperty("--text-scale");
  } else {
    target.style.setProperty("--text-scale", String(appearance.textScale / 100));
  }

  if (appearance.chatWidth === CHAT_WIDTH.default) {
    target.style.removeProperty("--content-w");
  } else {
    target.style.setProperty("--content-w", `${appearance.chatWidth}px`);
  }

  if (appearance.codeFontSize === CODE_FONT_SIZE.default) {
    target.style.removeProperty("--code-font-size");
  } else {
    target.style.setProperty("--code-font-size", `${appearance.codeFontSize}px`);
  }
}

export function setTextScale(value: unknown): void {
  const parsed = TextScaleSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.textScale = parsed.data;
  applyAppearance();
  persistAppearanceRecord();
}

export function setSummaryScale(value: unknown): void {
  const parsed = SummaryScaleSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.summaryScale = parsed.data;
  persistAppearanceRecord();
}

export function setChatWidth(value: unknown): void {
  const parsed = ChatWidthSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.chatWidth = parsed.data;
  applyAppearance();
  persistAppearanceRecord();
}

export function syncCodeFontSize(value: unknown): void {
  const parsed = CodeFontSizeSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.codeFontSize = parsed.data;
  applyAppearance();
}

export function setCodeFontSize(value: unknown): void {
  const parsed = CodeFontSizeSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.codeFontSize = parsed.data;
  applyAppearance();
  persistCodeFontSize(parsed.data);
}

export function setTerminalFontSize(value: unknown): void {
  const parsed = TerminalFontSizeSchema.safeParse(value);
  if (!parsed.success) return;
  appearance.terminalFontSize = parsed.data;
  writeStorage(TERMINAL_FONT_SIZE_STORAGE_KEY, String(parsed.data));
}

export function isAppearanceCustomized(): boolean {
  return (
    appearance.textScale !== TEXT_SCALE.default ||
    appearance.summaryScale !== SUMMARY_SCALE.default ||
    appearance.chatWidth !== CHAT_WIDTH.default ||
    appearance.codeFontSize !== CODE_FONT_SIZE.default ||
    appearance.terminalFontSize !== TERMINAL_FONT_SIZE.default
  );
}

export function resetAppearance(): void {
  setTextScale(TEXT_SCALE.default);
  setSummaryScale(SUMMARY_SCALE.default);
  setChatWidth(CHAT_WIDTH.default);
  setCodeFontSize(CODE_FONT_SIZE.default);
  setTerminalFontSize(TERMINAL_FONT_SIZE.default);
}

export function initializeAppearance(): () => void {
  const next = initialAppearance();
  appearance.textScale = next.textScale;
  appearance.summaryScale = next.summaryScale;
  appearance.chatWidth = next.chatWidth;
  appearance.codeFontSize = next.codeFontSize;
  appearance.terminalFontSize = next.terminalFontSize;
  applyAppearance();

  const sync = (event: StorageEvent): void => {
    if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) {
      const record = parseAppearanceRecord(event.key === null ? null : event.newValue);
      appearance.textScale = record.textScale;
      appearance.summaryScale = record.summaryScale;
      appearance.chatWidth = record.chatWidth;
      applyAppearance();
    }
    if (event.key === null || event.key === IDE_LAYOUT_STORAGE_KEY) {
      appearance.codeFontSize = parseCodeFontSize(event.key === null ? null : event.newValue);
      applyAppearance();
    }
    if (event.key === null || event.key === TERMINAL_FONT_SIZE_STORAGE_KEY) {
      appearance.terminalFontSize = parseTerminalFontSize(
        event.key === null ? null : event.newValue,
      );
    }
  };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}
