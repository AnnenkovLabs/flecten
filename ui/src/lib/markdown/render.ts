import { Marked } from "marked";
import { t } from "../i18n.svelte";
import { isSafeUrl, sanitizeHtml } from "./sanitize";

const LANGUAGE = /^[a-z0-9_+#.-]{1,24}$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function codeBlock(text: string, lang: string | undefined): string {
  const language = lang?.trim().split(/\s+/)[0] ?? "";
  const safeLanguage = language && LANGUAGE.test(language) ? language.toLowerCase() : "";
  const label = safeLanguage || "text";
  const className = safeLanguage ? ` class="language-${safeLanguage}"` : "";
  const copyName = escapeHtml(safeLanguage ? t("Copy code: {0}", [safeLanguage]) : t("Copy code"));
  const source = escapeHtml(text);
  const head = `<div class="code-head"><span class="code-lang">${label}</span><button type="button" class="code-copy" aria-label="${copyName}">${escapeHtml(t("Copy"))}</button></div>`;
  const code = `<pre><code${className}>${source}</code></pre>`;
  if (safeLanguage === "mermaid") {
    return `<figure class="code-block diagram mermaid-diagram">${head}<div class="mermaid-canvas">${code}</div><details class="diagram-source"><summary>${escapeHtml(t("Diagram source"))}</summary><pre><code class="language-mermaid">${source}</code></pre></details></figure>\n`;
  }
  return `<div class="code-block">${head}${code}</div>\n`;
}

const parser = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = isSafeUrl(href ?? "", "link");
      if (!url) return label;
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${titleAttribute} rel="noreferrer noopener" target="_blank">${label}</a>`;
    },
    image({ href, title, text }) {
      const url = isSafeUrl(href ?? "", "image");
      if (!url) return escapeHtml(text);
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttribute}>`;
    },
    code({ text, lang }) {
      return codeBlock(text, lang);
    },
  },
});

export function renderMarkdown(text: string): string {
  const html = parser.parse(text);
  if (typeof html !== "string") return "";
  return sanitizeHtml(html);
}
