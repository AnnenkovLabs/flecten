import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { MERMAID_CONFIG, MERMAID_THEME } from "../../ui/src/lib/markdown/mermaid";
import { renderMarkdown } from "../../ui/src/lib/markdown/render";
import {
  parseSummaryMessage,
  SANITIZE_CONFIG,
  SUMMARY_CSP,
  SUMMARY_SANDBOX,
  sanitizeHtml,
  sanitizeSvg,
} from "../../ui/src/lib/markdown/sanitize";
import { ACCENT_ROLES_CSS, summaryKitCss } from "../../ui/src/lib/markdown/summary-kit";
import { themeCss } from "../../ui/src/lib/markdown/theme";
import { HARNESS_TOKENS } from "../../ui/src/lib/markdown/tokens";

function uiFile(path: string): string {
  return readFileSync(new URL(`../../ui/src/${path}`, import.meta.url), "utf8");
}

const markdownSource = uiFile("components/Markdown.svelte");
const summarySource = uiFile("components/HtmlSummary.svelte");
const mermaidSource = uiFile("lib/markdown/mermaid.ts");

describe("renderMarkdown", () => {
  it("renders headings and paragraphs", () => {
    const html = renderMarkdown("# Title\n\nBody");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body</p>");
  });

  it("renders GFM tables", () => {
    const html = renderMarkdown("| Name | Value |\n| --- | --- |\n| one | 1 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<td>one</td>");
  });

  it("renders fenced code with a language", () => {
    const html = renderMarkdown('```ts\nconst x = "<img>";\n```');
    expect(html).toContain('class="language-ts"');
    expect(html).toContain("&lt;img&gt;");
  });

  it("labels every fence and gives it a copy button with an accessible name", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```\n\n```\nplain\n```");
    expect(html.match(/class="code-copy"/g)?.length).toBe(2);
    expect(html).toContain('<span class="code-lang">ts</span>');
    expect(html).toContain('<span class="code-lang">text</span>');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Копировать код: ts"');
    expect(html).toContain('aria-label="Копировать код"');
    expect(html).toContain(">Копировать</button>");
  });

  it("renders mermaid fences as a diagram with a source alternative", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```");
    expect(html).toContain("mermaid-diagram");
    expect(html).toContain("mermaid-canvas");
    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain("<summary>Исходный код диаграммы</summary>");
    expect(html).toContain("A --&gt; B");
    expect(html).toContain('aria-label="Копировать код: mermaid"');
  });

  it("keeps copy feedback local and accessible", () => {
    expect(markdownSource).toContain("copyText(value)");
    expect(markdownSource).toContain('t("Copied")');
    expect(markdownSource).toContain('setAttribute("aria-label"');
    expect(markdownSource).toContain("button.code-copy");
    expect(markdownSource).toContain(".diagram-source code");
  });

  it("lazy-loads and sanitizes the mermaid renderer without app context", () => {
    expect(mermaidSource).toContain('import("mermaid")');
    expect(mermaidSource).toContain('securityLevel: "strict"');
    expect(mermaidSource).toContain("sanitizeSvg");
    expect(mermaidSource).not.toMatch(/from "\.\.\/(?:run|store|core|app)/);
    expect(markdownSource).toContain(
      't("Could not render the Mermaid diagram. The source code is shown below.")',
    );
    expect(markdownSource).toContain("showFailure");
    expect(sanitizeSvg("<svg></svg>")).toBeNull();
  });

  it("draws diagram labels as SVG text, because the sanitizer drops foreignObject", () => {
    expect(MERMAID_CONFIG.htmlLabels).toBe(false);
    expect(MERMAID_CONFIG.securityLevel).toBe("strict");
    expect(uiFile("lib/markdown/sanitize.ts")).toContain('"foreignObject"');
  });

  it("renders task lists", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain("done");
  });

  it("opens links in a new tab without a referrer", () => {
    const html = renderMarkdown("[site](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });

  it("does not turn raw HTML into live markup", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("sanitizeHtml", () => {
  it("removes scripts and their content", () => {
    const html = sanitizeHtml("<p>ok</p><script>alert(1)</script>");
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("removes event handlers from images", () => {
    const html = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(html).toContain('<img src="x">');
    expect(html.toLowerCase()).not.toContain("onerror");
  });

  it("removes javascript URLs", () => {
    const html = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<a>x</a>");
  });

  it("removes javascript URLs hidden behind whitespace", () => {
    const html = sanitizeHtml('<a href="java\nscript:alert(1)">x</a>');
    expect(html).not.toContain("href");
    expect(html).not.toContain("javascript:");
  });

  it("removes javascript URLs hidden behind entities", () => {
    const letter = sanitizeHtml('<a href="jav&#x61;script:alert(1)">x</a>');
    const colon = sanitizeHtml('<a href="javascript&#58;alert(1)">x</a>');
    expect(letter).not.toContain("href");
    expect(colon).not.toContain("href");
  });

  it("keeps query separators in links", () => {
    const html = renderMarkdown("[x](https://example.com/?a=1&b=2)");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).not.toContain("&amp;amp;");
  });

  it("removes iframes, objects, embeds and external styles", () => {
    const html = sanitizeHtml(
      '<p>ok</p><iframe src="https://example.com"></iframe><object></object><embed><style>body{color:red}</style>',
    );
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<embed");
    expect(html).not.toContain("<style");
  });

  it("drops inline styles", () => {
    const html = sanitizeHtml('<p style="color:red">x</p>');
    expect(html).toBe("<p>x</p>");
  });

  it("keeps copy buttons with an accessible name and no handlers", () => {
    const html = sanitizeHtml(
      '<button type="button" class="code-copy" aria-label="Копировать" onclick="alert(1)">x</button>',
    );
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('class="code-copy"');
    expect(html).toContain('aria-label="Копировать"');
    expect(html).not.toContain("onclick");
  });

  it("keeps the allowlist free of active content", () => {
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).not.toContain("script");
    expect(SANITIZE_CONFIG.ALLOWED_TAGS).not.toContain("iframe");
    expect(SANITIZE_CONFIG.ALLOWED_ATTR).not.toContain("style");
    expect(SANITIZE_CONFIG.ALLOWED_ATTR).not.toContain("onerror");
    expect(SANITIZE_CONFIG.ALLOW_DATA_ATTR).toBe(false);
  });
});

describe("summary messages", () => {
  it("accepts a bounded height message", () => {
    expect(
      parseSummaryMessage({ type: "liquid-summary", version: 1, kind: "height", height: 480.4 }),
    ).toEqual({ type: "liquid-summary", version: 1, kind: "height", height: 481 });
  });

  it("rejects invalid height messages", () => {
    const base = { type: "liquid-summary", version: 1, kind: "height" };
    expect(parseSummaryMessage({ ...base, height: -1 })).toBeNull();
    expect(parseSummaryMessage({ ...base, height: Number.NaN })).toBeNull();
    expect(parseSummaryMessage({ ...base, height: "480" })).toBeNull();
    expect(parseSummaryMessage({ ...base, height: 20001 })).toBeNull();
    expect(parseSummaryMessage({ ...base, version: 2, height: 480 })).toBeNull();
    expect(
      parseSummaryMessage({ type: "other", version: 1, kind: "height", height: 480 }),
    ).toBeNull();
  });

  it("accepts only known actions with a bounded payload", () => {
    const message = {
      type: "liquid-summary",
      version: 1,
      kind: "action",
      action: "copy",
      payload: "text",
    } as const;
    expect(parseSummaryMessage(message)).toEqual(message);
    expect(parseSummaryMessage({ ...message, action: "eval" })).toBeNull();
    expect(parseSummaryMessage({ ...message, payload: "" })).toBeNull();
    expect(parseSummaryMessage({ ...message, payload: "x".repeat(4001) })).toBeNull();
  });

  it("accepts ready and content notifications from the frame", () => {
    const base = { type: "liquid-summary", version: 1 } as const;
    expect(parseSummaryMessage({ ...base, kind: "ready" })).toEqual({ ...base, kind: "ready" });
    expect(parseSummaryMessage({ ...base, kind: "content" })).toEqual({
      ...base,
      kind: "content",
    });
    expect(parseSummaryMessage({ ...base, kind: "ready", extra: true })).toEqual({
      ...base,
      kind: "ready",
    });
    expect(parseSummaryMessage({ ...base, version: 2, kind: "ready" })).toBeNull();
  });

  it("pins the iframe sandbox and content policy", async () => {
    const source = readFileSync(
      new URL("../../ui/src/components/HtmlSummary.svelte", import.meta.url),
      "utf8",
    );
    expect(SUMMARY_SANDBOX).toBe("allow-scripts");
    expect(source).toContain("sandbox={SUMMARY_SANDBOX}");
    expect(source).not.toContain("allow-same-origin");
    expect(SUMMARY_CSP).toContain("default-src 'none'");
    expect(SUMMARY_CSP).toContain("script-src 'unsafe-inline'");
    expect(SUMMARY_CSP).toContain("connect-src 'none'");
    expect(SUMMARY_CSP).toContain("img-src data: blob:");
    expect(SUMMARY_CSP).not.toContain("img-src data: blob: https:");
    const shell = await Bun.file(new URL("../../shell/main.mjs", import.meta.url)).text();
    expect(shell).toContain(SUMMARY_CSP);
    expect(shell).toContain('protocol.handle("liquid-summary"');
  });
});

describe("theme", () => {
  it("ships the Wikipedia layout classes", () => {
    for (const className of [
      ".float-right",
      ".float-left",
      ".infobox",
      ".thumb",
      ".gallery",
      ".toc",
      ".diagram",
    ]) {
      expect(themeCss).toContain(className);
    }
  });

  it("ships the summary layout kit", () => {
    for (const className of [
      ".lead",
      ".stat-grid",
      ".stat-value",
      ".stat-label",
      ".card",
      ".split",
      ".callout",
      ".is-good",
      ".is-warn",
      ".is-bad",
      ".pill-row",
      ".pill",
      ".meta",
    ]) {
      expect(themeCss).toContain(className);
    }
    expect(themeCss).toContain(".markdown.summary");
  });

  it("uses harness tokens and readable measure", () => {
    expect(themeCss).toContain("Manrope");
    expect(themeCss).toContain("--primary");
    expect(themeCss).toContain("max-width: 65ch");
    expect(themeCss).toContain("overflow-x: auto");
    expect(themeCss).toContain("@media (max-width: 640px)");
    expect(themeCss).toContain("box-sizing: border-box");
  });

  it("matches the token values declared in app.css", () => {
    const appCss = readFileSync(new URL("../../ui/src/app.css", import.meta.url), "utf8");
    const start = appCss.indexOf(":root {");
    const root = appCss.slice(start, appCss.indexOf("}", start));
    for (const [name, value] of Object.entries(HARNESS_TOKENS)) {
      const match = root.match(new RegExp(`${name}:\\s*([^;]+);`));
      expect(match?.[1]?.trim()).toBe(value);
    }
  });

  it("keeps accent inside focus and active tab roles", () => {
    const blocks = themeCss.match(/[^{}]+\{[^{}]*var\(--primary\)[^{}]*\}/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toMatch(/focus-visible|aria-selected="true"/);
    }
    expect(themeCss).not.toContain("var(--primary-hover)");
    expect(themeCss).not.toContain("accent-color: var(--primary)");
  });

  it("ships the interactive and diagram kit of the summary", () => {
    for (const className of [
      "table[data-sort]",
      "input[data-filter]",
      ".bars",
      ".bar-track",
      ".flow",
      ".timeline",
      ".thumb.is-left",
      "[data-toggle]",
      "button.is-primary",
    ]) {
      expect(summaryKitCss).toContain(className);
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the component source holds this template literally
    expect(summarySource).toContain("${themeCss}${summaryKitCss}");
  });

  it("gives accent to the summary only through its roles", () => {
    const blocks = summaryKitCss.match(/[^{}]+\{[^{}]*var\(--primary\)[^{}]*\}/g) ?? [];
    for (const block of blocks) expect(block).toMatch(/focus-visible|is-primary/);
    for (const role of [":focus-visible", '[aria-selected="true"]', ".is-primary"]) {
      expect(ACCENT_ROLES_CSS).toContain(role);
    }
    expect(ACCENT_ROLES_CSS).toContain("--primary:var(--summary-accent)");
    expect(summarySource).toContain('"--primary": "--summary-accent"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the component source holds this template literally
    expect(summarySource).toContain("${name}:var(--text-2)");
    for (const token of ["--success", "--error", "--on-primary", "--primary-end", "--ease"]) {
      expect(Object.keys(HARNESS_TOKENS)).toContain(token);
    }
  });

  it("embeds the declarative kit before the runtime in the summary document", async () => {
    const shell = await Bun.file(new URL("../../shell/main.mjs", import.meta.url)).text();
    const kit = await Bun.file(new URL("../../shell/summary-kit.js", import.meta.url)).text();
    const runtime = await Bun.file(
      new URL("../../shell/summary-runtime.js", import.meta.url),
    ).text();
    expect(shell.indexOf("summary-kit.js")).toBeLessThan(shell.indexOf("summary-runtime.js"));
    for (const name of ["prepare(root)", "click(element)", "input(element)"]) {
      expect(kit).toContain(name);
    }
    expect(runtime).toContain("globalThis.summaryKit?.prepare(root)");
    expect(runtime).toContain("globalThis.summaryKit?.click(element)");
  });

  it("uses one typeface and no embedded second font", () => {
    expect(themeCss).toContain("Manrope");
    expect(themeCss).not.toContain("@font-face");
    const families = themeCss.match(/font-family:[^;]+;/g) ?? [];
    for (const declaration of families) {
      expect(declaration).toMatch(/var\(--(?:font|mono)/);
    }
  });

  it("renders mermaid with harness theme variables", () => {
    expect(MERMAID_THEME.fontFamily).toBe(HARNESS_TOKENS["--font"]);
    expect(MERMAID_THEME.themeVariables.mainBkg).toBe(HARNESS_TOKENS["--surface"]);
    expect(MERMAID_THEME.themeVariables.lineColor).toBe(HARNESS_TOKENS["--text-2"]);
    expect(MERMAID_THEME.themeVariables.textColor).toBe(HARNESS_TOKENS["--text"]);
  });

  it("gives the summary iframe harness tokens and the embedded Manrope faces", () => {
    expect(summarySource).toContain("getComputedStyle(document.documentElement)");
    expect(summarySource).toContain("HARNESS_TOKENS");
    expect(summarySource).toContain("font-family:var(--font)");
    expect(summarySource).toContain("@font-face");
    expect(summarySource).toContain("data:font/woff2;base64");
    expect(summarySource).toContain("font-display:block");
    expect(summarySource).toContain("max-width:100%");
    expect(summarySource).toContain("sandbox={SUMMARY_SANDBOX}");
    expect(summarySource).not.toContain("allow-same-origin");
    expect(SUMMARY_CSP).toContain("font-src data:");
    expect(HARNESS_TOKENS["--font"]).toContain("Manrope");
  });

  it("does not put a long dash into copy, diagram or summary UI", () => {
    for (const source of [
      themeCss,
      markdownSource,
      summarySource,
      mermaidSource,
      renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```"),
    ]) {
      expect(source).not.toContain("—");
    }
  });
});
