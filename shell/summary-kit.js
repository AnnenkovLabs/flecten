// Declarative behavior for HTML summaries: sortable tables, filters and toggles. The model
// writes attributes, this trusted code writes the behavior, so a summary needs no script.
(() => {
  const collator = new Intl.Collator(document.documentElement.lang || "en", {
    numeric: true,
    sensitivity: "base",
  });
  const IGNORED = new Set([" ", "\u00a0", "\u202f", "%", "$", "€", "₽", "+", "×"]);

  // A number as people write it: spaces between thousands, a decimal comma, a unit sign.
  const numberOf = (text) => {
    let digits = "";
    for (const char of text) {
      if (IGNORED.has(char)) continue;
      if (char === "," || char === ".") digits += ".";
      else if (char === "-" || char === "\u2212") digits += "-";
      else if (char >= "0" && char <= "9") digits += char;
      else return Number.NaN;
    }
    return digits.length > 0 ? Number(digits) : Number.NaN;
  };

  const cellText = (row, index) => (row.cells[index]?.textContent || "").trim();

  const sortBy = (button) => {
    const cell = button.closest("th");
    const table = button.closest("table");
    const body = table?.tBodies[0];
    if (!cell || !table || !body) return;
    const index = Number(button.getAttribute("data-column"));
    const direction = cell.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const header of Array.from(table.querySelectorAll("th[aria-sort]"))) {
      header.removeAttribute("aria-sort");
    }
    cell.setAttribute("aria-sort", direction);
    const sign = direction === "ascending" ? 1 : -1;
    const rows = Array.from(body.rows);
    rows.sort((left, right) => {
      const a = cellText(left, index);
      const b = cellText(right, index);
      const x = numberOf(a);
      const y = numberOf(b);
      const order = Number.isNaN(x) || Number.isNaN(y) ? collator.compare(a, b) : x - y;
      return order * sign;
    });
    body.append(...rows);
  };

  const prepareTables = (root) => {
    for (const table of Array.from(root.querySelectorAll("table[data-sort]"))) {
      const head = table.tHead?.rows[0];
      if (!head || !table.tBodies[0]) continue;
      Array.from(head.cells).forEach((cell, index) => {
        if (cell.querySelector(".sort")) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sort";
        button.setAttribute("data-column", String(index));
        button.append(...Array.from(cell.childNodes));
        cell.append(button);
      });
    }
  };

  const filterItems = (target) => {
    if (target instanceof HTMLTableElement) return Array.from(target.tBodies[0]?.rows || []);
    return Array.from(target.children);
  };

  const filter = (input) => {
    const target = document.getElementById(input.getAttribute("data-filter") || "");
    if (!target) return;
    const query = input.value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const item of filterItems(target)) {
      const match = query === "" || (item.textContent || "").toLocaleLowerCase().includes(query);
      item.hidden = !match;
      if (match) shown += 1;
    }
    input.setAttribute("aria-description", shown === 0 ? "No matches" : `Matches: ${shown}`);
  };

  const prepareToggles = (root) => {
    for (const button of Array.from(root.querySelectorAll("[data-toggle]"))) {
      const id = button.getAttribute("data-toggle") || "";
      const target = document.getElementById(id);
      if (!target) continue;
      button.setAttribute("aria-controls", id);
      button.setAttribute("aria-expanded", target.hidden ? "false" : "true");
    }
  };

  // Auto-hydrates declarative shorthands so the model can emit ultra-compact tags without verbose DOM boilerplate.
  const prepareShorthands = (root) => {
    for (const stat of Array.from(root.querySelectorAll(".stat[data-value], .stat[data-label]"))) {
      if (stat.children.length > 0) continue;
      const val = stat.getAttribute("data-value") || stat.textContent || "";
      const lbl = stat.getAttribute("data-label") || "";
      stat.textContent = "";
      const vEl = document.createElement("span");
      vEl.className = "stat-value";
      vEl.textContent = val;
      const lEl = document.createElement("span");
      lEl.className = "stat-label";
      lEl.textContent = lbl;
      stat.append(vEl, lEl);
    }
    for (const bar of Array.from(root.querySelectorAll(".bar[data-label], .bar[data-value]"))) {
      if (bar.children.length > 0) continue;
      const lbl = bar.getAttribute("data-label") || bar.textContent || "";
      const val = bar.getAttribute("data-value") || "";
      if (val && !bar.style.getPropertyValue("--value")) {
        bar.style.setProperty("--value", val);
      }
      bar.textContent = "";
      const lEl = document.createElement("span");
      lEl.className = "bar-label";
      lEl.textContent = lbl;
      const tEl = document.createElement("span");
      tEl.className = "bar-track";
      const vEl = document.createElement("span");
      vEl.className = "bar-value";
      vEl.textContent = val;
      bar.append(lEl, tEl, vEl);
    }
    let tabGroupId = 0;
    for (const tabs of Array.from(root.querySelectorAll("[data-tabs]"))) {
      tabGroupId += 1;
      const panels = Array.from(tabs.querySelectorAll(":scope > section[data-tab], :scope > div[data-tab]"));
      if (panels.length === 0 || tabs.querySelector('[role="tablist"]')) continue;
      const list = document.createElement("div");
      list.setAttribute("role", "tablist");
      panels.forEach((panel, idx) => {
        const title = panel.getAttribute("data-tab") || `Tab ${idx + 1}`;
        const id = panel.id || `auto-tab-${tabGroupId}-${idx + 1}`;
        panel.id = id;
        panel.setAttribute("role", "tabpanel");
        if (idx > 0) panel.hidden = true;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", idx === 0 ? "true" : "false");
        btn.setAttribute("data-tab-target", id);
        btn.textContent = title;
        list.append(btn);
      });
      tabs.prepend(list);
    }
    for (const copyBtn of Array.from(root.querySelectorAll("[data-copy]"))) {
      if (!copyBtn.hasAttribute("data-summary-action")) {
        copyBtn.setAttribute("data-summary-action", "copy");
        copyBtn.setAttribute("data-summary-payload", copyBtn.getAttribute("data-copy") || "");
      }
    }
  };

  const prepareDeclarativeInteractions = (root) => {
    if (!globalThis.flectenSummary) return;
    const deliverEl = root.querySelector("[data-deliver]");
    const captureEls = Array.from(root.querySelectorAll("[data-capture]"));
    const flushEls = Array.from(root.querySelectorAll("[data-flush]"));
    if (!deliverEl && captureEls.length === 0 && flushEls.length === 0) return;

    const when = (deliverEl?.getAttribute("data-deliver") || (flushEls.length > 0 ? "on-action" : "next-message")).trim();
    const delayAttr = Number(deliverEl?.getAttribute("data-delay-ms") || "0");
    globalThis.flectenSummary.deliver(
      delayAttr > 0 ? { when, delayMs: delayAttr } : { when },
    );
    for (const el of captureEls) {
      if (el.dataset.boundCapture) continue;
      el.dataset.boundCapture = "1";
      const evtName =
        el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
          ? "change"
          : el instanceof HTMLFormElement
            ? "submit"
            : "click";
      el.addEventListener(evtName, (event) => {
        if (evtName === "submit") event.preventDefault();
        const name = el.getAttribute("data-capture") || "";
        let value = el.getAttribute("data-value");
        if (value === null) {
          if (el instanceof HTMLInputElement && el.type === "checkbox") value = el.checked;
          else if ("value" in el && typeof el.value === "string") value = el.value;
        }
        globalThis.flectenSummary.capture(event, name, value);
      });
    }
    for (const el of flushEls) {
      if (el.dataset.boundFlush) continue;
      el.dataset.boundFlush = "1";
      el.addEventListener("click", (event) => {
        globalThis.flectenSummary.flush(event);
      });
    }
  };

  const toggle = (button) => {
    const target = document.getElementById(button.getAttribute("data-toggle") || "");
    if (!target) return;
    target.hidden = !target.hidden;
    button.setAttribute("aria-expanded", target.hidden ? "false" : "true");
  };

  globalThis.summaryKit = {
    prepare(root) {
      prepareShorthands(root);
      prepareTables(root);
      prepareToggles(root);
      prepareDeclarativeInteractions(root);
    },
    /** Handles a click the kit owns; returns false for everything else. */
    click(element) {
      const sort = element.closest(".sort[data-column]");
      if (sort) {
        sortBy(sort);
        return true;
      }
      const switcher = element.closest("[data-toggle]");
      if (switcher) {
        toggle(switcher);
        return true;
      }
      return false;
    },
    input(element) {
      if (!(element instanceof HTMLInputElement) || !element.hasAttribute("data-filter")) return false;
      filter(element);
      return true;
    },
  };
})();
