import type { ILink, ILinkProvider, ITerminalOptions, ITheme, Terminal } from "@xterm/xterm";

export interface TerminalMatch {
  row: number;
  col: number;
  length: number;
}

export interface TerminalLinkHandlers {
  onUrl: (url: string) => void;
  onFile?: (path: string, line?: number, column?: number) => void;
}

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 22;

const URL_STOP_CHARS = new Set([" ", "\t", '"', "'", "`", "<", ">", "(", ")", "[", "]", "{", "}"]);
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);
const PATH_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/~@+";

export function buildTerminalTheme(host: HTMLElement): ITheme {
  const tokens = getComputedStyle(host);
  const bg = tokens.getPropertyValue("--bg").trim() || "#171717";
  const fg = tokens.getPropertyValue("--text-body").trim() || "rgba(240, 239, 237, 0.86)";
  const cursor = tokens.getPropertyValue("--primary").trim() || "#b7a1e8";
  const onPrimary = tokens.getPropertyValue("--on-primary").trim() || "#1b1422";
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: onPrimary,
    selectionBackground: "rgba(183, 161, 232, 0.30)",
    selectionInactiveBackground: "rgba(183, 161, 232, 0.16)",
    scrollbarSliderBackground: "rgba(240, 239, 237, 0.14)",
    scrollbarSliderHoverBackground: "rgba(240, 239, 237, 0.26)",
    scrollbarSliderActiveBackground: "rgba(240, 239, 237, 0.38)",
    black: "#1b1b1d",
    red: "#e28b8b",
    green: "#97c48f",
    yellow: "#e2c886",
    blue: "#8ab2e8",
    magenta: "#c2a8f2",
    cyan: "#7ac9b8",
    white: "#dcdad7",
    brightBlack: "#6d6b68",
    brightRed: "#f0a3a3",
    brightGreen: "#afd6a8",
    brightYellow: "#eed89e",
    brightBlue: "#a7c8f4",
    brightMagenta: "#d4c0fa",
    brightCyan: "#96ddd0",
    brightWhite: "#f5f4f2",
  };
}

export function buildTerminalOptions(
  host: HTMLElement,
  fontSize: number,
  reducedMotion: boolean,
): ITerminalOptions {
  const tokens = getComputedStyle(host);
  const mono =
    tokens.getPropertyValue("--mono").trim() ||
    'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", monospace';
  return {
    allowProposedApi: true,
    cursorBlink: !reducedMotion,
    cursorStyle: "bar",
    cursorWidth: 2,
    customGlyphs: true,
    fontSize,
    lineHeight: 1.22,
    letterSpacing: 0,
    fontFamily: mono,
    scrollback: 10_000,
    screenReaderMode: false,
    macOptionIsMeta: true,
    scrollOnUserInput: true,
    altClickMovesCursor: true,
    rightClickSelectsWord: false,
    smoothScrollDuration: 0,
    minimumContrastRatio: 4.5,
    theme: buildTerminalTheme(host),
  };
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function parsePositiveInt(text: string): number | undefined {
  if (!text) return undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!ch || !isDigit(ch)) return undefined;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function scanUrls(lineText: string, lineNumber: number, onUrl: (url: string) => void): ILink[] {
  const links: ILink[] = [];
  let cursor = 0;
  while (cursor < lineText.length) {
    const http = lineText.indexOf("http://", cursor);
    const https = lineText.indexOf("https://", cursor);
    let start = -1;
    if (http >= 0 && https >= 0) start = Math.min(http, https);
    else start = Math.max(http, https);
    if (start < 0) break;

    let end = start;
    while (end < lineText.length && !URL_STOP_CHARS.has(lineText[end] ?? "")) end += 1;
    while (end > start && TRAILING_PUNCTUATION.has(lineText[end - 1] ?? "")) end -= 1;
    const text = lineText.slice(start, end);
    if (text.length > 8) {
      links.push({
        range: {
          start: { x: start + 1, y: lineNumber },
          end: { x: end, y: lineNumber },
        },
        text,
        activate: (event, uri) => {
          if (event.ctrlKey || event.metaKey) onUrl(uri);
        },
      });
    }
    cursor = Math.max(end, start + 1);
  }
  return links;
}

function isPathChar(char: string): boolean {
  return PATH_CHARS.includes(char);
}

function scanFileLinks(
  lineText: string,
  lineNumber: number,
  onFile: (path: string, line?: number, column?: number) => void,
): ILink[] {
  const links: ILink[] = [];
  let index = 0;
  while (index < lineText.length) {
    if (!isPathChar(lineText[index] ?? "")) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < lineText.length && isPathChar(lineText[index] ?? "")) index += 1;
    const pathPart = lineText.slice(start, index);
    if (
      !pathPart.includes("/") ||
      pathPart.startsWith("http://") ||
      pathPart.startsWith("https://") ||
      pathPart.endsWith("/")
    ) {
      continue;
    }
    const lastSegment = pathPart.slice(pathPart.lastIndexOf("/") + 1);
    const hasExtension = lastSegment.includes(".") && lastSegment.length > 2;
    let end = index;
    let line: number | undefined;
    let column: number | undefined;
    if (lineText[end] === ":") {
      let numEnd = end + 1;
      while (numEnd < lineText.length && isDigit(lineText[numEnd] ?? "")) numEnd += 1;
      const parsedLine = parsePositiveInt(lineText.slice(end + 1, numEnd));
      if (parsedLine !== undefined) {
        line = parsedLine;
        end = numEnd;
        if (lineText[end] === ":") {
          let colEnd = end + 1;
          while (colEnd < lineText.length && isDigit(lineText[colEnd] ?? "")) colEnd += 1;
          const parsedCol = parsePositiveInt(lineText.slice(end + 1, colEnd));
          if (parsedCol !== undefined) {
            column = parsedCol;
            end = colEnd;
          }
        }
      }
    }
    if (!hasExtension && line === undefined) continue;
    const cleanPath = pathPart.startsWith("./") ? pathPart.slice(2) : pathPart;
    const text = lineText.slice(start, end);
    links.push({
      range: {
        start: { x: start + 1, y: lineNumber },
        end: { x: end, y: lineNumber },
      },
      text,
      activate: (event) => {
        if (event.ctrlKey || event.metaKey) onFile(cleanPath, line, column);
      },
    });
  }
  return links;
}

export function createTerminalLinkProvider(
  terminal: Terminal,
  handlers: TerminalLinkHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      if (!text.trim()) {
        callback(undefined);
        return;
      }
      const links: ILink[] = [...scanUrls(text, bufferLineNumber, handlers.onUrl)];
      if (handlers.onFile) {
        links.push(...scanFileLinks(text, bufferLineNumber, handlers.onFile));
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

/** Searches all lines in the active terminal buffer (scrollback + viewport) without regexes. */
export function searchTerminalBuffer(
  terminal: Terminal,
  query: string,
  caseSensitive: boolean,
): TerminalMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const buffer = terminal.buffer.active;
  const matches: TerminalMatch[] = [];
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const raw = line.translateToString(true);
    if (!raw) continue;
    const haystack = caseSensitive ? raw : raw.toLowerCase();
    let offset = 0;
    while (offset <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, offset);
      if (found < 0) break;
      matches.push({ row, col: found, length: query.length });
      offset = found + Math.max(1, needle.length);
    }
  }
  return matches;
}

export function highlightTerminalMatch(terminal: Terminal, match: TerminalMatch): void {
  terminal.select(match.col, match.row, match.length);
  const targetLine = Math.max(0, match.row - Math.floor(terminal.rows / 3));
  terminal.scrollToLine(targetLine);
}

export function isTerminalFocused(target: EventTarget | null = document.activeElement): boolean {
  return target instanceof Element && target.closest(".xterm") !== null;
}

/**
 * Prevents shell startup scripts (e.g., pywal/matugen/light terminal themes) from
 * overwriting Flecten's dark terminal palette via OSC 4/10/11/12/17, while still
 * letting "?" color queries resolve against our dark theme.
 */
export function protectTerminalPalette(terminal: Terminal): () => void {
  const disposables = [4, 10, 11, 12, 17].map((code) =>
    terminal.parser.registerOscHandler(code, (data) => {
      if (data === "?" || data.endsWith(";?")) return false;
      return true;
    }),
  );
  return () => {
    for (const disposable of disposables) disposable.dispose();
  };
}
