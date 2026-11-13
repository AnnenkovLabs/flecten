export type VoiceState = "idle" | "requesting" | "listening" | "processing" | "error";

const OPENING_PUNCTUATION = "([{«\"'";
const TRAILING_PUNCTUATION = ",.!?;:…)]}»";

export function insertTranscript(
  text: string,
  caret: number,
  transcript: string,
): { text: string; caret: number } {
  const clean = transcript.trim();
  const at = Math.max(0, Math.min(caret, text.length));
  if (clean.length === 0) return { text, caret: at };

  const before = text.slice(0, at);
  const after = text.slice(at);
  const prefix = needsSpaceBefore(before) ? " " : "";
  const suffix = needsSpaceAfter(after) ? " " : "";
  return {
    text: `${before}${prefix}${clean}${suffix}${after}`,
    caret: before.length + prefix.length + clean.length,
  };
}

function needsSpaceBefore(before: string): boolean {
  const last = before.charAt(before.length - 1);
  return last.length > 0 && !isWhitespace(last) && !OPENING_PUNCTUATION.includes(last);
}

function needsSpaceAfter(after: string): boolean {
  const first = after.charAt(0);
  return first.length > 0 && !isWhitespace(first) && !TRAILING_PUNCTUATION.includes(first);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t";
}
