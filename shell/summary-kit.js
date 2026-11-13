// Declarative behavior for HTML summaries: sortable tables, filters and toggles. The model
// writes attributes, this trusted code writes the behavior, so a summary needs no script.
(() => {
  const collator = new Intl.Collator(document.documentElement.lang || "ru", {
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
    input.setAttribute("aria-description", shown === 0 ? "Ничего не найдено" : `Найдено: ${shown}`);
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

  const toggle = (button) => {
    const target = document.getElementById(button.getAttribute("data-toggle") || "");
    if (!target) return;
    target.hidden = !target.hidden;
    button.setAttribute("aria-expanded", target.hidden ? "false" : "true");
  };

  globalThis.summaryKit = {
    prepare(root) {
      prepareTables(root);
      prepareToggles(root);
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
