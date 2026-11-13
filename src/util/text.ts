// Small string helpers used instead of ad hoc regular expressions.

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) if (char < "0" || char > "9") return false;
  return true;
}

/** Four dot-separated groups of digits, like 127.0.0.1. */
export function isIPv4(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every(isDigits);
}

export function withoutPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isAsciiAlphanumeric(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "0" && char <= "9");
}

/** Lowercase letters and digits only: `GPT-4.1 mini` becomes `gpt41mini`. */
export function alphanumericLower(value: string): string {
  let out = "";
  for (const char of value.toLowerCase()) if (isAsciiAlphanumeric(char)) out += char;
  return out;
}

/** Lowercase words joined by single dashes: `My Provider (EU)` becomes `my-provider-eu`. */
export function dashSlug(value: string): string {
  let out = "";
  let gap = false;
  for (const char of value.toLowerCase()) {
    if (isAsciiAlphanumeric(char)) {
      if (gap && out.length > 0) out += "-";
      out += char;
      gap = false;
    } else gap = true;
  }
  return out;
}

/** Whitespace runs as single spaces, trimmed: one readable line for previews and catalogs. */
export function oneLine(value: string): string {
  let line = "";
  let space = false;
  for (const char of value) {
    if (char.trim() === "") {
      space = line.length > 0;
      continue;
    }
    if (space) line += " ";
    line += char;
    space = false;
  }
  return line;
}
