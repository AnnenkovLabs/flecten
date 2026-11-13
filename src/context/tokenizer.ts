import type { ContextMessage, TokenEstimate, TokenProfile } from "./types";

const BASE_CHARS_PER_TOKEN = 4;
const EMOJI_TOKENS = 2.5;
const NEWLINE_TOKENS = 1;

const ROLE_TOKEN_OVERHEAD = 4;
const TOOL_CALL_TOKEN_OVERHEAD = 6;
const TOOL_RESULT_TOKEN_OVERHEAD = 3;
export const IMAGE_TOKEN_OVERHEAD = 85;

type ContentMode = "prose" | "code" | "json";
type CharClass =
  | "latin"
  | "cyrillic"
  | "cjk"
  | "code"
  | "json"
  | "base64"
  | "digits"
  | "whitespace";

const CHARS_PER_TOKEN: Record<CharClass, number> = {
  latin: 4,
  cyrillic: 2.4,
  cjk: 1.5,
  code: 3,
  json: 2.3,
  base64: 1.5,
  digits: 3,
  whitespace: 4,
};

interface Span {
  readonly start: number;
  readonly end: number;
}

function scale(profile: TokenProfile): number {
  return profile.charsPerToken > 0 ? profile.charsPerToken / BASE_CHARS_PER_TOKEN : 1;
}

function charsPerToken(charClass: CharClass, profile: TokenProfile): number {
  return CHARS_PER_TOKEN[charClass] * scale(profile);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isBase64Code(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === 43 || code === 47 || code === 61;
}

function isBase64Symbol(code: number): boolean {
  return code === 43 || code === 47 || code === 61;
}

function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function isStructuralJson(code: number): boolean {
  return (
    code === 123 ||
    code === 125 ||
    code === 91 ||
    code === 93 ||
    code === 34 ||
    code === 58 ||
    code === 44
  );
}

function isCodePunctuation(code: number): boolean {
  return (
    code === 59 ||
    code === 61 ||
    code === 40 ||
    code === 41 ||
    code === 60 ||
    code === 62 ||
    code === 35 ||
    code === 47 ||
    code === 42 ||
    code === 43 ||
    code === 45 ||
    code === 95 ||
    code === 38 ||
    code === 124 ||
    code === 33 ||
    code === 63 ||
    code === 46 ||
    code === 92 ||
    code === 58
  );
}

function isWhitespace(code: number): boolean {
  if (code === 32 || code === 9 || code === 11 || code === 12 || code === 13) return true;
  if (code === 0xa0 || code === 0x1680) return true;
  if (code >= 0x2000 && code <= 0x200a) return true;
  return (
    code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000
  );
}

function isCyrillic(code: number): boolean {
  return (
    (code >= 0x0400 && code <= 0x052f) ||
    (code >= 0x1c80 && code <= 0x1c8f) ||
    (code >= 0x2de0 && code <= 0x2dff) ||
    (code >= 0xa640 && code <= 0xa69f)
  );
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x2fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

function isEmoji(code: number): boolean {
  return (
    (code >= 0x1f000 && code <= 0x1f2ff) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x2b00 && code <= 0x2bff)
  );
}

function isEmojiJoiner(code: number): boolean {
  return (
    code === 0xfe0f || code === 0x200d || code === 0x20e3 || (code >= 0x1f3fb && code <= 0x1f3ff)
  );
}

function detectMode(text: string): ContentMode {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "prose";

  const first = trimmed.charCodeAt(0);
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if ((first === 123 || first === 91) && (last === 125 || last === 93)) return "json";

  let structural = 0;
  let codePunctuation = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index);
    if (isStructuralJson(code)) structural += 1;
    if (isCodePunctuation(code)) codePunctuation += 1;
  }

  if (structural / trimmed.length > 0.18) return "json";
  if (codePunctuation / trimmed.length > 0.08) return "code";
  return "prose";
}

function collectBase64Spans(text: string): Span[] {
  const spans: Span[] = [];
  let start = -1;
  let upper = false;
  let lower = false;
  let digit = false;
  let symbol = false;

  const finish = (end: number): void => {
    if (start >= 0 && end - start >= 40 && ((upper && lower && digit) || symbol)) {
      spans.push({ start, end });
    }
    start = -1;
    upper = false;
    lower = false;
    digit = false;
    symbol = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!isBase64Code(code)) {
      finish(index);
      continue;
    }
    if (start < 0) start = index;
    if (code >= 65 && code <= 90) upper = true;
    else if (code >= 97 && code <= 122) lower = true;
    else if (isAsciiDigit(code)) digit = true;
    else if (isBase64Symbol(code)) symbol = true;
  }
  finish(text.length);
  return spans;
}

function inSpans(spans: readonly Span[], spanIndex: number, index: number): boolean {
  const span = spans[spanIndex];
  return span !== undefined && index >= span.start && index < span.end;
}

function confidenceFor(text: string, classes: ReadonlySet<CharClass>, mode: ContentMode): number {
  const lengthFactor = Math.min(1, text.length / 200);
  let confidence = 0.55 + 0.35 * lengthFactor;
  if (classes.size >= 3) confidence -= 0.05;
  if (mode === "json" || mode === "code") confidence += 0.03;
  if (text.length < 20) confidence -= 0.1;
  return Math.round(Math.min(0.95, Math.max(0.4, confidence)) * 100) / 100;
}

export function estimateTokens(text: string, profile: TokenProfile): TokenEstimate {
  if (text.length === 0) return { tokens: 0, confidence: 1 };

  const mode = detectMode(text);
  const spans = mode === "prose" ? collectBase64Spans(text) : [];
  const classes = new Set<CharClass>();
  let tokens = 0;
  let spanIndex = 0;

  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index) ?? 0;
    const char = String.fromCodePoint(code);
    while (spanIndex < spans.length && (spans[spanIndex]?.end ?? 0) <= index) spanIndex += 1;

    if (isEmojiJoiner(code)) {
      index += char.length;
      continue;
    }
    if (code === 10) {
      tokens += NEWLINE_TOKENS;
      index += char.length;
      continue;
    }
    if (isWhitespace(code)) {
      tokens += 1 / charsPerToken("whitespace", profile);
      index += char.length;
      continue;
    }
    if (isEmoji(code)) {
      tokens += EMOJI_TOKENS * (BASE_CHARS_PER_TOKEN / Math.max(1, profile.charsPerToken));
      classes.add("cjk");
      index += char.length;
      continue;
    }

    let charClass: CharClass;
    if (isCyrillic(code)) {
      charClass = "cyrillic";
    } else if (isCjk(code)) {
      charClass = "cjk";
    } else if (code >= 0x80) {
      charClass = "latin";
    } else if (inSpans(spans, spanIndex, index)) {
      charClass = "base64";
    } else if (isAsciiDigit(code)) {
      charClass = mode === "prose" ? "digits" : mode;
    } else if (isAsciiLetter(code)) {
      charClass = mode === "prose" ? "latin" : mode;
    } else if (isAsciiPunctuation(code)) {
      charClass = mode === "json" ? "json" : "code";
    } else {
      charClass = "latin";
    }

    classes.add(charClass);
    tokens += 1 / charsPerToken(charClass, profile);
    index += char.length;
  }

  return {
    tokens: Math.ceil(tokens),
    confidence: confidenceFor(text, classes, mode),
  };
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function imageCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function estimateMessages(
  messages: readonly ContextMessage[],
  profile: TokenProfile,
): TokenEstimate {
  let tokens = 0;
  let weighted = 0;
  let weight = 0;

  const add = (estimate: TokenEstimate): void => {
    tokens += estimate.tokens;
    weighted += estimate.tokens * estimate.confidence;
    weight += estimate.tokens;
  };
  const addFixed = (amount: number): void => {
    tokens += amount;
    weighted += amount * 0.9;
    weight += amount;
  };

  for (const message of messages) {
    addFixed(ROLE_TOKEN_OVERHEAD);
    add(estimateTokens(message.content, profile));

    if (message.role === "assistant") {
      if (message.reasoning) add(estimateTokens(message.reasoning, profile));
      for (const call of message.toolCalls ?? []) {
        addFixed(TOOL_CALL_TOKEN_OVERHEAD);
        add(estimateTokens(call.name, profile));
        if (call.args !== undefined) add(estimateTokens(textOf(call.args), profile));
      }
      if (message.providerData !== undefined) {
        add(estimateTokens(textOf(message.providerData), profile));
      }
    }

    if (message.role === "tool") {
      addFixed(TOOL_RESULT_TOKEN_OVERHEAD);
      add(estimateTokens(message.name, profile));
    }

    const media = message.role === "user" ? imageCount(message.mediaTokens) : 0;
    const images = imageCount(message.images);
    if (media > 0) addFixed(media);
    else if (images > 0) addFixed(images * IMAGE_TOKEN_OVERHEAD);
  }

  return {
    tokens: Math.ceil(tokens),
    confidence: weight > 0 ? Math.round((weighted / weight) * 100) / 100 : 0.9,
  };
}
