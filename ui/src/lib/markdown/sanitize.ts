import type { Config, DOMPurify, WindowLike } from "dompurify";
import createDOMPurify from "dompurify";
import { parseSummaryDestination, type SummaryDestination } from "./summary-navigation";

const ALLOWED_TAGS = new Set(
  "a blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr img input kbd li mark ol p pre s section small span strong sub summary sup table tbody td tfoot th thead tr ul".split(
    " ",
  ),
);
const ALLOWED_ATTR = new Set(
  "align alt aria-label checked class colspan disabled href rowspan scope src start title type".split(
    " ",
  ),
);
const VOID_TAGS = new Set("br col hr img input wbr".split(" "));
const BLOCKED_CONTENT = new Set(
  "applet audio base canvas embed form frame frameset iframe link math meta noembed noframes noscript object option plaintext script select source style svg template textarea title track video xmp".split(
    " ",
  ),
);
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const IMAGE_SCHEME = /^https?:/i;
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]*$/i;
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["colon", ":"],
  ["gt", ">"],
  ["lt", "<"],
  ["newline", "\n"],
  ["quot", '"'],
  ["sol", "/"],
  ["tab", "\t"],
]);

function fromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});?/g, (_, decimal: string) =>
      fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/gi, (entity: string, name: string) => {
      return NAMED_ENTITIES.get(name.toLowerCase()) ?? entity;
    });
}
function stripControls(value: string): string {
  return value.replace(/[\p{Cc}\s]/gu, "");
}

export function isSafeUrl(raw: string, kind: "link" | "image" = "link"): string | null {
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  const compact = stripControls(decodeEntities(value));
  if (/^data:/i.test(compact)) {
    return kind === "image" && DATA_IMAGE.test(compact) ? value : null;
  }
  if (EXPLICIT_SCHEME.test(compact)) {
    const allowed = kind === "image" ? IMAGE_SCHEME : SAFE_SCHEME;
    return allowed.test(compact) ? value : null;
  }
  return value;
}
export const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: [...ALLOWED_ATTR, "rel", "target"],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_SELF_CLOSE_IN_ATTR: false,
  ALLOWED_URI_REGEXP,
  FORBID_ATTR: ["formaction", "srcdoc", "style", "xlink:href"],
  FORBID_TAGS: "base embed form iframe link math meta object script style svg template".split(" "),
  KEEP_CONTENT: true,
};

export function sanitizeSvg(svg: string): string | null {
  if (!purifier) return null;
  const clean = String(
    purifier.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
      FORBID_ATTR: ["onload", "onerror", "onclick", "xlink:href"],
    }),
  ).trim();
  return /^<svg[\s>]/i.test(clean) ? clean : null;
}

export const SUMMARY_SANDBOX = "allow-scripts";
export const SUMMARY_CSP =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'none'";

export type SummaryAction = "copy" | "navigate";
export type SummaryHeightMessage = {
  type: "liquid-summary";
  version: 1;
  kind: "height";
  height: number;
};
export type SummaryActionMessage = {
  type: "liquid-summary";
  version: 1;
  kind: "action";
} & ({ action: "copy"; payload: string } | { action: "navigate"; destination: SummaryDestination });
export type SummaryReadyMessage = {
  type: "liquid-summary";
  version: 1;
  kind: "ready";
};
export type SummaryContentMessage = {
  type: "liquid-summary";
  version: 1;
  kind: "content";
};
export type SummaryMessage =
  | SummaryHeightMessage
  | SummaryActionMessage
  | SummaryReadyMessage
  | SummaryContentMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSummaryMessage(data: unknown): SummaryMessage | null {
  if (!isRecord(data) || data.type !== "liquid-summary" || data.version !== 1) return null;
  if (data.kind === "ready" || data.kind === "content") {
    return { type: "liquid-summary", version: 1, kind: data.kind };
  }
  if (data.kind === "height") {
    const height = data.height;
    if (typeof height !== "number" || !Number.isFinite(height) || height < 0 || height > 20000) {
      return null;
    }
    return { type: "liquid-summary", version: 1, kind: "height", height: Math.ceil(height) };
  }
  if (data.kind !== "action") return null;
  const action = data.action;
  const payload = data.payload;
  if (typeof payload !== "string" || payload.length === 0 || payload.length > 4000) return null;
  if (action === "navigate") {
    const destination = parseSummaryDestination(payload);
    return destination
      ? { type: "liquid-summary", version: 1, kind: "action", action, destination }
      : null;
  }
  if (action !== "copy") return null;
  return {
    type: "liquid-summary",
    version: 1,
    kind: "action",
    action,
    payload,
  };
}
function browserPurifier(): DOMPurify | null {
  const root = (globalThis as { window?: unknown }).window;
  if (!root) return null;
  const purifier = createDOMPurify(root as WindowLike);
  if (!purifier.isSupported) return null;
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noreferrer noopener");
  });
  return purifier;
}

const purifier = browserPurifier();
// ponytail: Bun tests have no DOM, so the non-browser path is a strict allowlist
// tokenizer. The renderer uses DOMPurify wherever a window exists; delete this
// fallback once tests can run with a real DOM.
export function sanitizeHtml(html: string): string {
  if (purifier) return String(purifier.sanitize(html, SANITIZE_CONFIG));
  return sanitizeWithoutDom(html);
}
function isNameStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}
function readName(html: string, start: number): { name: string; end: number } {
  let index = start;
  while (index < html.length) {
    const char = html.charAt(index);
    const valid = isNameStart(char) || (char >= "0" && char <= "9") || char === "-" || char === ":";
    if (!valid) break;
    index += 1;
  }
  return { name: html.slice(start, index).toLowerCase(), end: index };
}
function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const char = html.charAt(index);
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return html.length;
}

// Attribute syntax is a boundary format, so a regex is enough here.
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function readTag(html: string, start: number): { attrs: Array<[string, string]>; end: number } {
  const end = findTagEnd(html, start);
  const source = html.slice(start, Math.max(start, end - 1));
  const attrs: Array<[string, string]> = [];
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attrs.push([name, match[2] ?? match[3] ?? match[4] ?? ""]);
  }
  return { attrs, end };
}
function skipBlocked(html: string, lower: string, from: number, tag: string): number {
  if (tag === "plaintext") return html.length;
  const close = lower.indexOf(`</${tag}`, from);
  if (close < 0) return html.length;
  const end = html.indexOf(">", close);
  return end < 0 ? html.length : end + 1;
}
function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function cleanAttribute(tag: string, name: string, value: string): [string, string] | null {
  if (name.startsWith("on") || !ALLOWED_ATTR.has(name)) return null;
  if (name === "href") {
    if (tag !== "a") return null;
    const url = isSafeUrl(value, "link");
    return url ? [name, url] : null;
  }
  if (name === "src") {
    if (tag !== "img") return null;
    const url = isSafeUrl(value, "image");
    return url ? [name, url] : null;
  }
  if (name === "alt" || name === "title") return [name, value.slice(0, 2048)];
  if (name === "aria-label") return tag === "button" ? [name, value.slice(0, 200)] : null;
  if (name === "class") {
    const classes = value.split(/\s+/).filter((item) => /^[a-z0-9_-]{1,40}$/i.test(item));
    return classes.length > 0 ? [name, classes.join(" ")] : null;
  }
  if (name === "type") {
    const type = value.toLowerCase();
    if (tag === "input" && type === "checkbox") return [name, "checkbox"];
    if (tag === "button" && type === "button") return [name, "button"];
    return null;
  }
  if (name === "checked" || name === "disabled") return tag === "input" ? [name, ""] : null;
  if (name === "start") return tag === "ol" && /^\d{1,6}$/.test(value) ? [name, value] : null;
  if (name === "colspan" || name === "rowspan") {
    return (tag === "th" || tag === "td") && /^\d{1,3}$/.test(value) ? [name, value] : null;
  }
  if (name === "align") {
    const allowed =
      tag === "th" || tag === "td" || tag === "col" || tag === "colgroup" || tag === "table";
    return allowed && /^(?:left|right|center|justify)$/i.test(value)
      ? [name, value.toLowerCase()]
      : null;
  }
  if (name === "scope") {
    return tag === "th" && /^(?:row|col|rowgroup|colgroup)$/i.test(value)
      ? [name, value.toLowerCase()]
      : null;
  }
  return null;
}
function sanitizeWithoutDom(html: string): string {
  const lower = html.toLowerCase();
  const stack: string[] = [];
  let output = "";
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) {
      output += html.slice(index).replace(/</g, "&lt;");
      break;
    }
    output += html.slice(index, open).replace(/</g, "&lt;");
    index = open;
    if (html.startsWith("<!--", index)) {
      const close = html.indexOf("-->", index + 4);
      index = close < 0 ? html.length : close + 3;
      continue;
    }
    const next = html.charAt(index + 1);
    if (next === "!" || next === "?") {
      const close = html.indexOf(">", index + 2);
      index = close < 0 ? html.length : close + 1;
      continue;
    }
    if (next === "/") {
      const closing = readName(html, index + 2);
      const close = html.indexOf(">", closing.end);
      index = close < 0 ? html.length : close + 1;
      const position = stack.lastIndexOf(closing.name);
      if (position >= 0) {
        while (stack.length > position) output += `</${stack.pop()}>`;
      }
      continue;
    }
    if (!isNameStart(next)) {
      output += "&lt;";
      index += 1;
      continue;
    }
    const opening = readName(html, index + 1);
    const tag = readTag(html, opening.end);
    index = tag.end;
    const name = opening.name;
    if (!ALLOWED_TAGS.has(name)) {
      if (BLOCKED_CONTENT.has(name)) index = skipBlocked(html, lower, index, name);
      continue;
    }
    let attributes = "";
    let hasHref = false;
    for (const [attribute, value] of tag.attrs) {
      const cleaned = cleanAttribute(name, attribute, value);
      if (!cleaned) continue;
      if (cleaned[0] === "href") hasHref = true;
      attributes += ` ${cleaned[0]}="${escapeAttribute(cleaned[1])}"`;
    }
    if (name === "a" && hasHref) attributes += ' rel="noreferrer noopener" target="_blank"';
    output += `<${name}${attributes}>`;
    if (!VOID_TAGS.has(name)) stack.push(name);
  }
  while (stack.length > 0) output += `</${stack.pop()}>`;
  return output;
}
