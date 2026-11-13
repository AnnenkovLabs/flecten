/**
 * Interactive and diagram blocks of the HTML summary: sortable and filtered tables, bar
 * charts, flow diagrams, timelines, toggles and the one accent button. The behavior lives
 * in shell/summary-kit.js; the model writes only classes and data attributes.
 */
export const summaryKitCss = `
.markdown.summary table[data-sort] th { padding: 0; }
.markdown.summary .sort {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  border: 0;
  border-radius: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.markdown.summary .sort::after {
  content: "";
  width: 7px;
  height: 7px;
  flex: none;
  margin-left: auto;
  border-right: 1.5px solid var(--muted);
  border-bottom: 1.5px solid var(--muted);
  opacity: 0.35;
  transform: rotate(45deg) translateY(-2px);
}
.markdown.summary th[aria-sort] .sort::after { opacity: 1; }
.markdown.summary th[aria-sort="ascending"] .sort::after { transform: rotate(-135deg) translateY(-2px); }
.markdown.summary .sort:hover { background: var(--raised); }

.markdown.summary input[data-filter] {
  width: min(100%, 320px);
  height: 36px;
  margin: 4px 0 0;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: 400 14px/1.3 var(--font);
}
.markdown.summary input[data-filter]::placeholder { color: var(--muted); }
.markdown.summary input[data-filter]:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.markdown.summary .filter-empty { color: var(--muted); font-size: 13px; }

.markdown.summary .bars { display: grid; gap: 8px; margin: 14px 0 16px; }
.markdown.summary .bar {
  display: grid;
  grid-template-columns: minmax(0, 11em) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
}
.markdown.summary .bar-label { overflow: hidden; color: var(--text-body); text-overflow: ellipsis; white-space: nowrap; }
.markdown.summary .bar-track { height: 8px; overflow: hidden; border-radius: 999px; background: var(--raised); }
.markdown.summary .bar-track::before {
  content: "";
  display: block;
  width: var(--value, 0%);
  max-width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--text-2);
}
.markdown.summary .bar.is-good .bar-track::before { background: var(--success); }
.markdown.summary .bar.is-warn .bar-track::before { background: var(--warning); }
.markdown.summary .bar.is-bad .bar-track::before { background: var(--error); }
.markdown.summary .bar-value { color: var(--text); font-variant-numeric: tabular-nums; }

.markdown.summary .flow {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 8px 28px;
  margin: 14px 0 16px;
  padding: 0;
  list-style: none;
}
.markdown.summary .flow > * {
  position: relative;
  flex: 1 1 140px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
  font-size: 13.5px;
  line-height: 1.45;
}
.markdown.summary .flow > * + *::before {
  content: "";
  position: absolute;
  top: 50%;
  left: -20px;
  width: 12px;
  height: 1.5px;
  background: var(--muted);
}
.markdown.summary .flow > * + *::after {
  content: "";
  position: absolute;
  top: calc(50% - 3.5px);
  left: -12px;
  width: 6px;
  height: 6px;
  border-top: 1.5px solid var(--muted);
  border-right: 1.5px solid var(--muted);
  transform: rotate(45deg);
}
.markdown.summary .flow strong { display: block; margin-bottom: 2px; }
.markdown.summary .flow .is-good { box-shadow: inset 0 0 0 1px var(--success); }
.markdown.summary .flow .is-bad { box-shadow: inset 0 0 0 1px var(--error); }

.markdown.summary .timeline { margin: 14px 0 16px; padding: 0 0 0 18px; list-style: none; }
.markdown.summary .timeline > li { position: relative; margin: 0; padding: 0 0 12px 4px; }
.markdown.summary .timeline > li::before {
  content: "";
  position: absolute;
  top: 0.6em;
  left: -15px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-2);
}
.markdown.summary .timeline > li:not(:last-child)::after {
  content: "";
  position: absolute;
  top: calc(0.6em + 10px);
  bottom: 2px;
  left: -12px;
  width: 1px;
  background: var(--line-strong);
}
.markdown.summary .timeline time, .markdown.summary .timeline .meta { display: block; }

.markdown.summary .thumb.is-left, .markdown.summary .infobox.is-left {
  float: left;
  clear: left;
  margin: 0 var(--space-6) var(--space-4) 0;
}
.markdown.summary .thumb svg { display: block; width: 100%; height: auto; }
.markdown.summary .clear { clear: both; }

.markdown.summary [data-toggle] { display: inline-flex; align-items: center; gap: 8px; }
.markdown.summary [data-toggle]::after {
  content: "";
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
  transition: transform 240ms var(--ease);
}
.markdown.summary [data-toggle][aria-expanded="true"]::after { transform: rotate(-135deg) translateY(-2px); }

.markdown.summary button.is-primary {
  border: 0;
  background: linear-gradient(180deg, var(--primary), var(--primary-end));
  color: var(--on-primary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38), inset 0 -1px 0 rgba(0, 0, 0, 0.18);
}

@media (max-width: 640px) {
  .markdown.summary .thumb.is-left, .markdown.summary .infobox.is-left { float: none; margin: 0 0 var(--space-4); }
  .markdown.summary .bar { grid-template-columns: minmax(0, 1fr) auto; }
  .markdown.summary .bar-track { grid-column: 1 / -1; grid-row: 2; }
}
`;

/**
 * Accent is a role, not a color: inside the summary var(--primary) is neutral and turns
 * accent only on focus, the selected tab and the primary button.
 */
export const ACCENT_ROLES_CSS =
  '.markdown :focus-visible,.markdown [aria-selected="true"],.markdown .is-primary{--primary:var(--summary-accent);--primary-end:var(--summary-accent-end);--primary-hover:var(--summary-accent-hover)}';
