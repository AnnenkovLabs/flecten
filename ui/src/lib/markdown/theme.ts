export const themeCss = `
.markdown, .markdown *, .markdown *::before, .markdown *::after { box-sizing: border-box; }
.markdown {
  min-width: 0;
  max-width: 65ch;
  background: var(--bg);
  color: var(--text-body);
  font: 400 16px/1.65 var(--font, "Manrope", system-ui, sans-serif);
  overflow-wrap: anywhere;
  text-wrap: pretty;
  -webkit-font-smoothing: antialiased;
}

.markdown::after { content: ""; display: block; clear: both; }
.markdown > :first-child { margin-top: 0; }
.markdown > :last-child { margin-bottom: 0; }
.markdown p, .markdown ul, .markdown ol, .markdown dl, .markdown pre,
.markdown blockquote, .markdown figure, .markdown details { margin: 0 0 var(--space-3); }

.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
  margin: var(--space-6) 0 var(--space-2);
  color: var(--text);
  font-weight: 600;
  line-height: 1.2;
  text-wrap: balance;
}
.markdown h1 { font-size: 24px; letter-spacing: -0.02em; }
.markdown h2 { font-size: 20px; letter-spacing: -0.01em; }
.markdown h3 { font-size: 18px; }
.markdown h4, .markdown h5, .markdown h6 { font-size: 16px; }

.markdown ul, .markdown ol { padding-left: 1.4em; }
.markdown li + li { margin-top: var(--space-1); }
.markdown li > ul, .markdown li > ol { margin: var(--space-1) 0 0; }

.markdown a {
  color: var(--text);
  text-decoration: underline;
  text-decoration-color: var(--line-strong);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.markdown a:hover { text-decoration-color: currentColor; }
.markdown a:focus-visible,
.markdown button:focus-visible,
.markdown [role="tab"]:focus-visible,
.markdown summary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 2px;
}
.markdown strong { color: var(--text); font-weight: 600; }
.markdown blockquote {
  padding: var(--space-2) 0 var(--space-2) var(--space-4);
  border-left: 2px solid var(--line-strong);
  color: var(--text-2);
}
.markdown hr { height: 0; margin: var(--space-6) 0; border: 0; border-top: 1px solid var(--line); }
.markdown img, .markdown svg { max-width: 100%; height: auto; border-radius: 6px; }

.markdown code, .markdown kbd {
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--raised);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.88em;
}
.markdown pre {
  max-width: 100%;
  padding: var(--space-4);
  overflow-x: auto;
  border-radius: 8px;
  background: var(--surface);
  line-height: 1.5;
}
.markdown pre code { padding: 0; background: none; font-size: 13px; white-space: pre; }

.markdown .code-block {
  min-width: 0;
  margin: 0 0 var(--space-3);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}
.markdown .code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 34px;
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
  border-bottom: 1px solid var(--line);
}
.markdown .code-lang { color: var(--muted); font: 500 12px/1.3 var(--mono); }
.markdown .code-head .code-copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 7px;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font: 500 11.5px/1.3 var(--font);
  cursor: pointer;
  transition:
    background 240ms var(--ease),
    color 240ms var(--ease),
    border-radius 460ms var(--ease-jelly);
}
.markdown .code-head .code-copy::before {
  content: "";
  width: 12px;
  height: 12px;
  flex: none;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.5 14.5C7.5 11.2002 7.5 9.55025 8.52513 8.52513C9.55025 7.5 11.2002 7.5 14.5 7.5C17.7998 7.5 19.4497 7.5 20.4749 8.52513C21.5 9.55025 21.5 11.2002 21.5 14.5C21.5 17.7998 21.5 19.4497 20.4749 20.4749C19.4497 21.5 17.7998 21.5 14.5 21.5C11.2002 21.5 9.55025 21.5 8.52513 20.4749C7.5 19.4497 7.5 17.7998 7.5 14.5Z'/%3E%3Cpath d='M7.5 16.5C6.10355 16.5 5.40533 16.5 4.84402 16.3036C3.83866 15.9518 3.0482 15.1613 2.69641 14.156C2.5 13.5947 2.5 12.8964 2.5 11.5V9.5C2.5 6.20017 2.5 4.55025 3.52513 3.52513C4.55025 2.5 6.20017 2.5 9.5 2.5H11.5C12.8964 2.5 13.5947 2.5 14.156 2.69641C15.1613 3.0482 15.9518 3.83866 16.3036 4.84402C16.5 5.40533 16.5 6.10355 16.5 7.5'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.5 14.5C7.5 11.2002 7.5 9.55025 8.52513 8.52513C9.55025 7.5 11.2002 7.5 14.5 7.5C17.7998 7.5 19.4497 7.5 20.4749 8.52513C21.5 9.55025 21.5 11.2002 21.5 14.5C21.5 17.7998 21.5 19.4497 20.4749 20.4749C19.4497 21.5 17.7998 21.5 14.5 21.5C11.2002 21.5 9.55025 21.5 8.52513 20.4749C7.5 19.4497 7.5 17.7998 7.5 14.5Z'/%3E%3Cpath d='M7.5 16.5C6.10355 16.5 5.40533 16.5 4.84402 16.3036C3.83866 15.9518 3.0482 15.1613 2.69641 14.156C2.5 13.5947 2.5 12.8964 2.5 11.5V9.5C2.5 6.20017 2.5 4.55025 3.52513 3.52513C4.55025 2.5 6.20017 2.5 9.5 2.5H11.5C12.8964 2.5 13.5947 2.5 14.156 2.69641C15.1613 3.0482 15.9518 3.83866 16.3036 4.84402C16.5 5.40533 16.5 6.10355 16.5 7.5'/%3E%3C/svg%3E") center / contain no-repeat;
}
.markdown .code-head .code-copy:hover {
  border-radius: 8px;
  background: rgba(240, 239, 237, 0.06);
  color: var(--text-2);
}
.markdown .code-head .code-copy.is-copied { color: var(--success); }
.markdown .code-head .code-copy.is-copied::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 13.2592L7.58583 15.9568C8.2525 16.6523 8.58583 17 9.00004 17C9.41425 17 9.74759 16.6523 10.4143 15.9568L19 7'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 13.2592L7.58583 15.9568C8.2525 16.6523 8.58583 17 9.00004 17C9.41425 17 9.74759 16.6523 10.4143 15.9568L19 7'/%3E%3C/svg%3E");
}
.markdown .code-block pre { margin: 0; padding: var(--space-3) var(--space-4); border-radius: 0; background: none; }

.markdown table {
  display: block;
  max-width: 100%;
  margin: var(--space-4) 0;
  overflow-x: auto;
  border-collapse: collapse;
}
.markdown caption { margin-bottom: var(--space-2); color: var(--muted); font-size: 12px; text-align: left; }
.markdown th, .markdown td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.markdown th { background: var(--raised); color: var(--text); font-weight: 600; }
.markdown tr:last-child td { border-bottom: 0; }
.markdown input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0 var(--space-1) 0 0;
  accent-color: var(--text-2);
  vertical-align: -2px;
}
.markdown mark { padding: 0 2px; background: var(--raised); color: var(--text); }

.markdown .float-right {
  float: right;
  clear: right;
  max-width: min(45%, 320px);
  margin: 0 0 var(--space-4) var(--space-6);
}
.markdown .float-left {
  float: left;
  clear: left;
  max-width: min(45%, 320px);
  margin: 0 var(--space-6) var(--space-4) 0;
}
.markdown .infobox {
  float: right;
  clear: right;
  max-width: 340px;
  width: 42%;
  margin: 0 0 var(--space-4) var(--space-6);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--surface);
  font-size: 14px;
  line-height: 1.5;
}
.markdown .infobox > :last-child { margin-bottom: 0; }
.markdown .infobox pre, .markdown .infobox table { max-width: 100%; }
.markdown .thumb {
  float: right;
  clear: right;
  max-width: 300px;
  width: 40%;
  margin: 0 0 var(--space-4) var(--space-6);
}
.markdown .thumb img { display: block; width: 100%; }
.markdown figcaption, .markdown .thumb figcaption {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
.markdown .gallery {
  display: grid;
  clear: both;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
  margin: var(--space-4) 0;
}
.markdown .gallery .thumb { float: none; width: auto; margin: 0; }

.markdown .toc {
  margin: var(--space-4) 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
.markdown .toc ul { margin: 0; padding-left: var(--space-4); }
.markdown .diagram {
  margin: var(--space-4) 0;
  padding: var(--space-4);
  max-width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  background: var(--surface);
}
.markdown .diagram svg { display: block; max-width: 100%; height: auto; }

.markdown .mermaid-diagram { padding: 0; overflow: hidden; }
.markdown .mermaid-canvas { max-width: 100%; padding: var(--space-3) var(--space-4); overflow-x: auto; }
.markdown .mermaid-canvas pre { padding: 0; background: none; }
.markdown .mermaid-canvas svg { margin: 0 auto; }
.markdown .diagram-source {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: none;
}
.markdown .diagram-source summary {
  padding: var(--space-2) var(--space-4);
  color: var(--muted);
  font: 500 12px/1.3 var(--font);
}
.markdown .diagram-source pre { margin: 0; padding: 0 var(--space-4) var(--space-3); background: none; }
.markdown .diagram-error {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--line);
  color: var(--warning);
  font-size: 13px;
}

.markdown .tabs, .markdown [role="tablist"] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: 8px;
  background: var(--surface);
}
.markdown .tab, .markdown [role="tab"] {
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font: 500 13px/1.3 var(--font);
  cursor: pointer;
}
.markdown [role="tab"][aria-selected="true"] {
  background: var(--raised);
  color: var(--text);
  box-shadow: inset 0 -2px 0 var(--primary);
}
.markdown [role="tabpanel"][hidden] { display: none; }
.markdown button:not([role="tab"]):not(.code-copy):not(.sort) {
  min-height: 36px;
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: 500 13px/1.3 var(--font);
  cursor: pointer;
}
.markdown button:not([role="tab"]):not(.code-copy):not(.sort):hover { background: var(--raised); }

.markdown details {
  padding: var(--space-3) var(--space-4);
  border-radius: 8px;
  background: var(--surface);
}
.markdown summary { color: var(--text); font-weight: 500; cursor: pointer; }
.markdown details[open] summary { margin-bottom: var(--space-2); }
.markdown .diagram-source[open] summary { margin-bottom: 0; }

.markdown.summary {
  max-width: none;
  background: transparent;
  font-size: 16px;
  line-height: 1.62;
}
.markdown.summary > :first-child { margin-top: 0; }
.markdown.summary p { margin-bottom: 10px; }
.markdown.summary h1 { font-size: 23px; }
.markdown.summary h2 { margin-top: 22px; font-size: 19px; letter-spacing: -0.01em; }
.markdown.summary h3 { margin-top: 18px; font-size: 16px; }
.markdown.summary h2 + p, .markdown.summary h3 + p { margin-top: 0; }
.markdown.summary .lead {
  margin-bottom: 16px;
  color: var(--text);
  font-size: 17px;
  line-height: 1.55;
  text-wrap: pretty;
}
.markdown.summary .meta {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
.markdown.summary .stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 8px;
  margin: 14px 0 16px;
}
.markdown.summary .stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 11px 13px;
  border-radius: 9px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
}
.markdown.summary .stat-value {
  color: var(--text);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.markdown.summary .stat-label {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.3;
  text-transform: none;
}
.markdown.summary .card {
  min-width: 0;
  margin: 14px 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
}
.markdown.summary .card > :first-child { margin-top: 0; }
.markdown.summary .card > :last-child { margin-bottom: 0; }
.markdown.summary .split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0;
}
.markdown.summary .split .card { margin: 0; }
.markdown.summary .callout {
  margin: 14px 0;
  padding: 11px 14px;
  border-left: 2px solid var(--line-strong);
  border-radius: 0 8px 8px 0;
  background: var(--surface);
  color: var(--text-body);
}
.markdown.summary .callout > :last-child { margin-bottom: 0; }
.markdown.summary .callout.is-good { border-left-color: var(--success); }
.markdown.summary .callout.is-warn { border-left-color: var(--warning); }
.markdown.summary .callout.is-bad { border-left-color: var(--error); }
.markdown.summary .pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
}
.markdown.summary .pill {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--raised);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.4;
}
.markdown.summary table {
  display: table;
  table-layout: fixed;
  width: 100%;
  margin: 12px 0 16px;
  overflow: visible;
  font-size: 14.5px;
}
.markdown.summary th, .markdown.summary td { overflow-wrap: anywhere; }
.markdown.summary [role="tabpanel"] { padding: 10px 2px 0; }
.markdown.summary pre { background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); }
.markdown.summary th { border-bottom-color: var(--line-strong); }
.markdown.summary td { border-bottom-color: var(--line); }
.markdown.summary hr { margin: 20px 0; }
.markdown.summary ul, .markdown.summary ol { margin-bottom: 10px; }

@media (max-width: 640px) {
  .markdown { max-width: none; }
  .markdown .float-right, .markdown .float-left, .markdown .infobox, .markdown .thumb {
    float: none;
    width: auto;
    max-width: none;
    margin: 0 0 var(--space-4);
  }
}

@media (max-width: 520px) {
  .markdown.summary .split { grid-template-columns: 1fr; }
}
`;
