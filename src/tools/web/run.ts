import type { ToolResult } from "../../core/types";
import { defineTool, type ToolContext } from "../types";
import { type WebFetchArgs, type WebSearchArgs, webFetchSpec, webSearchSpec } from "./schema";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 8;
const USER_AGENT = "Mozilla/5.0 (compatible; flecten/0.1)";
const SEARCH_URL = "https://html.duckduckgo.com/html/?q=";
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const BLOCK_TAGS = new Set(
  "address article aside blockquote br dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(
    " ",
  ),
);
const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failure(error: unknown): ToolResult {
  return { ok: false, output: "", error: message(error) };
}
function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}
function collapse(text: string): string {
  let output = "";
  let pendingSpace = false;
  for (const char of text) {
    if (isSpace(char)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output.length > 0) output += " ";
    pendingSpace = false;
    output += char;
  }
  return output;
}
function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => collapse(line))
    .filter((line) => line.length > 0)
    .join("\n");
}
function digitValue(char: string): number {
  if (char >= "0" && char <= "9") return char.charCodeAt(0) - 48;
  if (char >= "a" && char <= "f") return char.charCodeAt(0) - 87;
  if (char >= "A" && char <= "F") return char.charCodeAt(0) - 55;
  return -1;
}
function decodeEntity(name: string): string | undefined {
  const named = NAMED_ENTITIES[name.toLowerCase()];
  if (named !== undefined) return named;
  if (!name.startsWith("#")) return undefined;
  const body = name.slice(1);
  const hex = body.startsWith("x") || body.startsWith("X");
  const digits = hex ? body.slice(1) : body;
  if (digits.length === 0) return undefined;
  let code = 0;
  for (const char of digits) {
    const value = digitValue(char);
    if (value < 0 || value >= (hex ? 16 : 10)) return undefined;
    code = code * (hex ? 16 : 10) + value;
  }
  if (code === 0 || code > 0x10ffff) return "\uFFFD";
  return String.fromCodePoint(code);
}
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  let output = "";
  let index = 0;
  while (index < text.length) {
    const amp = text.indexOf("&", index);
    if (amp < 0) {
      output += text.slice(index);
      break;
    }
    output += text.slice(index, amp);
    const semicolon = text.indexOf(";", amp + 1);
    if (semicolon < 0 || semicolon - amp > 12) {
      output += "&";
      index = amp + 1;
      continue;
    }
    const decoded = decodeEntity(text.slice(amp + 1, semicolon));
    if (decoded === undefined) {
      output += "&";
      index = amp + 1;
      continue;
    }
    output += decoded;
    index = semicolon + 1;
  }
  return output;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && isSpace(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const nameStart = index;
    while (index < source.length && !isSpace(source[index] ?? "") && source[index] !== "=") {
      index += 1;
    }
    const name = source.slice(nameStart, index).toLowerCase();
    while (index < source.length && isSpace(source[index] ?? "")) index += 1;
    let value = "";
    if (source[index] === "=") {
      index += 1;
      while (index < source.length && isSpace(source[index] ?? "")) index += 1;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !isSpace(source[index] ?? "")) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    if (name.length > 0) attributes[name] = decodeEntities(value);
  }
  return attributes;
}

type ParsedTag = {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: Record<string, string>;
};

function parseTag(source: string): ParsedTag | undefined {
  let text = source.trim();
  if (text.startsWith("!") || text.startsWith("?")) return undefined;
  const closing = text.startsWith("/");
  if (closing) text = text.slice(1).trimStart();
  const selfClosing = text.endsWith("/");
  if (selfClosing) text = text.slice(0, -1);
  let index = 0;
  while (index < text.length && !isSpace(text[index] ?? "")) index += 1;
  const name = text.slice(0, index).toLowerCase();
  if (name.length === 0) return undefined;
  return { name, closing, selfClosing, attributes: parseAttributes(text.slice(index)) };
}

function classNames(value: string | undefined): string[] {
  if (value === undefined) return [];
  const names: string[] = [];
  let token = "";
  for (const char of value) {
    if (isSpace(char)) {
      if (token.length > 0) names.push(token);
      token = "";
    } else {
      token += char;
    }
  }
  if (token.length > 0) names.push(token);
  return names;
}

function closingTag(html: string, lower: string, name: string, from: number): number {
  const start = lower.indexOf(`</${name}`, from);
  return start < 0 ? html.length : start;
}

function afterClosingTag(html: string, lower: string, name: string, from: number): number {
  const start = closingTag(html, lower, name, from);
  if (start >= html.length) return html.length;
  const close = html.indexOf(">", start);
  return close < 0 ? html.length : close + 1;
}

export function htmlToText(html: string): { title: string; text: string } {
  const lower = html.toLowerCase();
  let title = "";
  let output = "";
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) {
      output += decodeEntities(html.slice(index));
      break;
    }
    output += decodeEntities(html.slice(index, open));

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }

    const close = html.indexOf(">", open + 1);
    if (close < 0) {
      output += decodeEntities(html.slice(open));
      break;
    }

    const tag = parseTag(html.slice(open + 1, close));
    if (tag === undefined) {
      index = close + 1;
      continue;
    }

    if (!tag.closing && !tag.selfClosing && SKIP_TAGS.has(tag.name)) {
      index = afterClosingTag(html, lower, tag.name, close + 1);
      continue;
    }

    if (!tag.closing && tag.name === "title") {
      const start = lower.indexOf("</title", close + 1);
      const raw = start < 0 ? html.slice(close + 1) : html.slice(close + 1, start);
      title = collapse(decodeEntities(raw));
      index = start < 0 ? html.length : afterClosingTag(html, lower, "title", close + 1);
      continue;
    }

    if (tag.name === "br" || BLOCK_TAGS.has(tag.name)) output += "\n";
    index = close + 1;
  }

  return { title, text: tidy(output) };
}

function resultUrl(href: string): string {
  let value = href.trim();
  if (value.startsWith("//")) value = `https:${value}`;
  else if (value.startsWith("/")) value = `https://duckduckgo.com${value}`;
  if (value.includes("duckduckgo.com/l/")) {
    const marker = "uddg=";
    const start = value.indexOf(marker);
    if (start >= 0) {
      let encoded = value.slice(start + marker.length);
      const amp = encoded.indexOf("&");
      if (amp >= 0) encoded = encoded.slice(0, amp);
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }
  }
  return value;
}

export type SearchResult = { title: string; url: string; snippet: string };

export function parseSearchResults(html: string): SearchResult[] {
  const lower = html.toLowerCase();
  const results: SearchResult[] = [];
  let pending: { title: string; url: string } | undefined;
  let index = 0;

  while (index < html.length && results.length < MAX_RESULTS) {
    const open = html.indexOf("<", index);
    if (open < 0) break;
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close < 0) break;
    const tag = parseTag(html.slice(open + 1, close));
    if (tag === undefined || tag.closing || tag.selfClosing) {
      index = close + 1;
      continue;
    }

    const classes = classNames(tag.attributes.class);
    if (classes.includes("result__a")) {
      if (pending !== undefined) results.push({ ...pending, snippet: "" });
      const end = closingTag(html, lower, tag.name, close + 1);
      const inner = html.slice(close + 1, end);
      pending = {
        title: collapse(htmlToText(inner).text),
        url: resultUrl(tag.attributes.href ?? ""),
      };
      index = afterClosingTag(html, lower, tag.name, close + 1);
      continue;
    }
    if (classes.includes("result__snippet") && pending !== undefined) {
      const end = closingTag(html, lower, tag.name, close + 1);
      const inner = html.slice(close + 1, end);
      results.push({ ...pending, snippet: collapse(htmlToText(inner).text) });
      pending = undefined;
      index = afterClosingTag(html, lower, tag.name, close + 1);
      continue;
    }
    index = close + 1;
  }

  if (pending !== undefined && results.length < MAX_RESULTS)
    results.push({ ...pending, snippet: "" });
  return results.slice(0, MAX_RESULTS);
}

function networkProblem(url: string, context: ToolContext): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: ${url}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Unsupported URL protocol: ${parsed.protocol}`;
  }
  if (context.sandbox === undefined) return undefined;
  const decision = context.sandbox.checkNetwork(parsed.hostname);
  if (decision.allowed) return undefined;
  return `Network access denied for "${parsed.hostname}": ${decision.reason}`;
}

async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<{ body: string; truncated: boolean }> {
  if (response.body === null) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > MAX_BYTES - bytes) {
        chunks.push(chunk.value.subarray(0, MAX_BYTES - bytes));
        bytes = MAX_BYTES;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(chunk.value);
      bytes += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(merged), truncated };
}

type PageResult =
  | { url: string; status: number; contentType: string; body: string; truncated: boolean }
  | { error: string };

async function fetchPage(url: string, context: ToolContext): Promise<PageResult> {
  const problem = networkProblem(url, context);
  if (problem !== undefined) return { error: problem };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const forward = () => controller.abort(context.signal.reason);
  if (context.signal.aborted) forward();
  else context.signal.addEventListener("abort", forward, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
      },
    });
    const body = await readBody(response, controller.signal);
    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText} for ${url}` };
    }
    return {
      url: response.url || url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      ...body,
    };
  } catch (error) {
    if (timedOut) return { error: `Fetch timed out after 10s: ${url}` };
    if (context.signal.aborted) return { error: `Fetch aborted: ${url}` };
    return { error: message(error) };
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", forward);
  }
}

function unsupportedType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  const binary = ["image/", "audio/", "video/"].some((prefix) => type.startsWith(prefix));
  return binary || type.includes("application/pdf") || type.includes("application/octet-stream");
}

export async function runWebFetch(args: WebFetchArgs, context: ToolContext): Promise<ToolResult> {
  const page = await fetchPage(args.url, context);
  if ("error" in page) return failure(page.error);
  if (unsupportedType(page.contentType)) {
    return failure(`Unsupported content type ${page.contentType} for ${page.url}`);
  }

  const start = page.body.trimStart().toLowerCase();
  const isHtml =
    page.contentType.toLowerCase().includes("html") ||
    ["<!doctype html", "<html", "<head", "<body"].some((prefix) => start.startsWith(prefix));
  const extracted = isHtml ? htmlToText(page.body) : { title: "", text: page.body.trim() };
  const output = [
    `Title: ${extracted.title.length > 0 ? extracted.title : "(untitled)"}`,
    `URL: ${page.url}`,
    `Content-Type: ${page.contentType || "unknown"}`,
    ...(page.truncated ? ["[response truncated at 2MB]"] : []),
    "",
    extracted.text,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      kind: "web_fetch",
      url: args.url,
      finalUrl: page.url,
      title: extracted.title,
      status: page.status,
      contentType: page.contentType,
      bytes: Buffer.byteLength(page.body, "utf8"),
      truncated: page.truncated,
    },
  };
}

export async function runWebSearch(args: WebSearchArgs, context: ToolContext): Promise<ToolResult> {
  const page = await fetchPage(`${SEARCH_URL}${encodeURIComponent(args.query)}`, context);
  if ("error" in page) return failure(page.error);

  const results = parseSearchResults(page.body);
  if (results.length === 0) {
    return {
      ok: true,
      output: "No search results.",
      data: { kind: "web_search", query: args.query, results: [] },
    };
  }

  const lines = results.flatMap((result, index) => [
    `${index + 1}. ${result.title}`,
    `   ${result.url}`,
    ...(result.snippet.length > 0 ? [`   ${result.snippet}`] : []),
  ]);

  return {
    ok: true,
    output: lines.join("\n"),
    data: { kind: "web_search", query: args.query, results },
  };
}

export const webFetchTool = defineTool({
  ...webFetchSpec,
  execute: runWebFetch,
});

export const webSearchTool = defineTool({
  ...webSearchSpec,
  execute: runWebSearch,
});
