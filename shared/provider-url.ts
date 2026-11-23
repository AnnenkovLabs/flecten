export type ProtocolHint = "openai-chat" | "openai-responses" | "anthropic-messages" | "gemini";

export interface CleanedBaseUrl {
  ok: true;
  baseUrl: string;
  changed: boolean;
  hintedProtocol?: ProtocolHint;
}

export interface InvalidBaseUrl {
  ok: false;
  error: "empty" | "unsupported_scheme" | "invalid";
}

export type BaseUrlResult = CleanedBaseUrl | InvalidBaseUrl;

const ENDPOINT_SUFFIXES: ReadonlyArray<readonly [string, ProtocolHint | undefined]> = [
  ["/chat/completions", "openai-chat"],
  ["/completions", "openai-chat"],
  ["/responses", "openai-responses"],
  ["/messages", "anthropic-messages"],
  ["/models", undefined],
];

const WRAP_START = new Set(['"', "'", "`", "\u201c", "\u2018", "<", "(", "["]);
const WRAP_END = new Set(['"', "'", "`", "\u201d", "\u2019", ">", ")", "]", ",", ";", "}"]);

function stripInvisible(value: string): string {
  return value
    .replaceAll("\uFEFF", "")
    .replaceAll("\u200B", "")
    .replaceAll("\u200C", "")
    .replaceAll("\u200D", "")
    .replaceAll("\u00A0", " ");
}

function unwrapToken(token: string): string {
  let out = token.trim();
  let changed = true;
  while (changed && out.length > 0) {
    changed = false;
    if (WRAP_START.has(out[0] ?? "")) {
      out = out.slice(1).trim();
      changed = true;
    }
    if (WRAP_END.has(out.at(-1) ?? "")) {
      out = out.slice(0, -1).trim();
      changed = true;
    }
  }
  return out;
}

function stripKeyPrefix(token: string): string {
  const eq = token.indexOf("=");
  if (eq <= 0) return token;
  const left = token.slice(0, eq).trim();
  const right = token.slice(eq + 1).trim();
  if (!right) return token;
  if (left.includes("://") || left.includes("/") || left.includes(".")) return token;
  return unwrapToken(right);
}

function looksLikeHostOrUrl(token: string): boolean {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return true;
  if (lower.startsWith("http:/") || lower.startsWith("https:/") || lower.startsWith("ttps://")) {
    return true;
  }
  if (lower.startsWith("localhost") || lower.startsWith("[::1]") || lower.startsWith("::1")) {
    return true;
  }
  if (token.startsWith("-") || token.startsWith("/") || token.includes("@")) return false;
  return token.includes(".") || token.includes(":");
}

function extractCandidate(raw: string): string {
  const cleaned = stripInvisible(raw).trim();
  if (!cleaned) return "";
  const mdLink = cleaned.indexOf("](");
  if (mdLink >= 0) {
    const close = cleaned.indexOf(")", mdLink + 2);
    if (close > mdLink + 2) {
      const inner = unwrapToken(cleaned.slice(mdLink + 2, close));
      if (looksLikeHostOrUrl(inner)) return inner;
    }
  }
  const tokens = cleaned
    .split(/\s+/)
    .map((part) => stripKeyPrefix(unwrapToken(part)))
    .filter(Boolean);
  if (tokens.length === 0) return "";
  const withScheme = tokens.find((token) => {
    const lower = token.toLowerCase();
    return (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("http:/") ||
      lower.startsWith("https:/") ||
      lower.startsWith("ttps://")
    );
  });
  if (withScheme) return withScheme;
  const hostLike = tokens.find(looksLikeHostOrUrl);
  return hostLike ?? tokens[0] ?? "";
}

function isLocalHost(hostWithPort: string): boolean {
  const lower = hostWithPort.toLowerCase();
  const host = lower.startsWith("[")
    ? lower.slice(0, lower.indexOf("]") + 1)
    : (lower.split(":")[0] ?? lower);
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  if (host.startsWith("172.")) {
    const second = Number(host.split(".")[1]);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

function repairScheme(candidate: string): { url: string; invalidScheme?: boolean } {
  const lower = candidate.toLowerCase();
  if (lower.startsWith("ttps://")) return { url: `https://${candidate.slice(7)}` };
  if (lower.startsWith("http:///")) return { url: `http://${candidate.slice(8)}` };
  if (lower.startsWith("https:///")) return { url: `https://${candidate.slice(9)}` };
  if (lower.startsWith("http:/") && !lower.startsWith("http://")) {
    return { url: `http://${candidate.slice(6)}` };
  }
  if (lower.startsWith("https:/") && !lower.startsWith("https://")) {
    return { url: `https://${candidate.slice(7)}` };
  }
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { url: candidate };
  }
  const colonSlash = candidate.indexOf("://");
  if (colonSlash > 0) return { url: candidate, invalidScheme: true };
  if (candidate.includes(":") && !candidate.includes("/") && !candidate.startsWith("[")) {
    const [prefix, rest] = candidate.split(":", 2);
    if (prefix && rest && !/^\d+$/.test(rest) && /^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(prefix)) {
      return { url: candidate, invalidScheme: true };
    }
  }
  const hostPart = candidate.split("/")[0] ?? candidate;
  const hostNorm = hostPart.startsWith("::1") ? `[::1]${hostPart.slice(3)}` : hostPart;
  const pathPart = candidate.includes("/") ? candidate.slice(candidate.indexOf("/")) : "";
  const scheme = isLocalHost(hostNorm) ? "http://" : "https://";
  return { url: `${scheme}${hostNorm}${pathPart}` };
}

function cleanPath(pathname: string): { path: string; hintedProtocol?: ProtocolHint } {
  const rawSegments = pathname.split("/").filter(Boolean);
  const segments: string[] = [];
  for (const segment of rawSegments) {
    const prev = segments.at(-1)?.toLowerCase();
    const cur = segment.toLowerCase();
    if (prev === cur && (cur === "v1" || cur === "v1beta" || cur === "v1alpha" || cur === "api")) {
      continue;
    }
    segments.push(segment);
  }

  let hintedProtocol: ProtocolHint | undefined;
  let path = segments.length > 0 ? `/${segments.join("/")}` : "";

  const lowerSegments = segments.map((s) => s.toLowerCase());
  const modelsIndex = lowerSegments.lastIndexOf("models");
  if (modelsIndex >= 0 && modelsIndex < segments.length - 1) {
    const afterModel = segments.slice(modelsIndex + 1).join("/");
    if (
      afterModel.includes(":streamGenerateContent") ||
      afterModel.includes(":generateContent") ||
      afterModel.includes(":countTokens")
    ) {
      hintedProtocol = "gemini";
      segments.splice(modelsIndex);
      path = segments.length > 0 ? `/${segments.join("/")}` : "";
    }
  }

  let stripped = true;
  while (stripped && path.length > 0) {
    stripped = false;
    const lower = path.toLowerCase();
    for (const [suffix, hint] of ENDPOINT_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        if (hint && !hintedProtocol) hintedProtocol = hint;
        path = path.slice(0, -suffix.length);
        stripped = true;
        break;
      }
    }
  }

  if (!hintedProtocol) {
    const tail = path.toLowerCase();
    if (tail.endsWith("/v1beta") || tail.endsWith("/v1alpha")) hintedProtocol = "gemini";
  }

  return { path, ...(hintedProtocol ? { hintedProtocol } : {}) };
}

/**
 * Extracts and normalizes any user-pasted provider URL: curl commands, quoted snippets,
 * schemeless domains/localhost, typos, duplicate slashes/versions, query strings, and full
 * endpoint paths (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, Gemini actions).
 */
export function cleanProviderBaseUrl(raw: string): BaseUrlResult {
  const trimmed = stripInvisible(raw).trim();
  if (!trimmed) return { ok: false, error: "empty" };
  const candidate = extractCandidate(trimmed);
  if (!candidate) return { ok: false, error: "invalid" };
  const repaired = repairScheme(candidate);
  if (repaired.invalidScheme) return { ok: false, error: "unsupported_scheme" };

  let parsed: URL;
  try {
    parsed = new URL(repaired.url);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported_scheme" };
  }
  if (!parsed.hostname) return { ok: false, error: "invalid" };
  const host = parsed.hostname.toLowerCase();
  if (!host.includes(".") && host !== "localhost" && !host.startsWith("[") && !parsed.port) {
    return { ok: false, error: "invalid" };
  }

  const { path, hintedProtocol } = cleanPath(parsed.pathname);
  const baseUrl = `${parsed.protocol}//${parsed.host}${path}`;
  return {
    ok: true,
    baseUrl,
    changed: baseUrl !== trimmed,
    ...(hintedProtocol ? { hintedProtocol } : {}),
  };
}
