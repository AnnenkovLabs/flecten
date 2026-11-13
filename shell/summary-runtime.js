(() => {
  const TYPE = "liquid-summary";
  const VERSION = 1;
  const SVG = "http://www.w3.org/2000/svg";
  const root = document.getElementById("summary-root");
  if (!root) return;
  const VOID = new Set("area br col embed hr img input link meta param source track wbr".split(" "));
  const RAW = new Set(
    "script style textarea title xmp iframe noembed noframes noscript".split(" "),
  );
  const SKIP = new Set("base link meta".split(" "));
  const ANIMATE = new Set(
    "p h1 h2 h3 h4 h5 h6 li td th pre blockquote figcaption dd dt img".split(" "),
  );
  const decoder = document.createElement("textarea");
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stack = [{ el: root, name: "#root" }];
  let svgDepth = 0;
  let contentSent = false;
  let lastHeight = -1;
  let scheduled = false;
  let finished = false;
  const scriptTypes = new WeakMap();

  const post = (message) => {
    parent.postMessage(Object.assign({ type: TYPE, version: VERSION }, message), "*");
  };
  const decode = (value) => {
    decoder.innerHTML = value;
    return decoder.value;
  };
  const current = () => stack[stack.length - 1].el;
  const report = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      post({ kind: "height", height });
    });
  };
  const reveal = (element) => {
    if (reduced || typeof element.animate !== "function") return;
    if (!ANIMATE.has(element.localName) || element.namespaceURI === SVG) return;
    element.animate(
      [
        { opacity: 0, transform: "translateY(9px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "both" },
    );
  };
  const tabContainer = (tab) =>
    tab.closest("[data-tabs]") ||
    tab.closest('[role="tablist"]')?.parentElement ||
    tab.parentElement;
  const activateTab = (container, tab, focus) => {
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));
    const target = tab.getAttribute("data-tab-target") || tab.getAttribute("aria-controls") || "";
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", selected ? "true" : "false");
      item.setAttribute("tabindex", selected ? "0" : "-1");
    }
    for (const panel of panels) panel.hidden = panel.id !== target;
    if (focus) tab.focus();
    report();
  };
  const initTabs = () => {
    const groups = new Set();
    for (const tab of Array.from(root.querySelectorAll('[role="tab"]'))) {
      const container = tabContainer(tab);
      if (container) groups.add(container);
    }
    for (const container of groups) {
      const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
      if (tabs.length === 0) continue;
      const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
      if (active) activateTab(container, active, false);
    }
  };
  const onClick = (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    const link = element.closest("a[href]");
    if (link) {
      event.preventDefault();
      const payload = link.getAttribute("href") || "";
      if (payload.length > 0 && payload.length <= 4000) post({ kind: "action", action: "navigate", payload });
      return;
    }
    const tab = element.closest('[role="tab"]');
    if (tab) {
      const container = tabContainer(tab);
      if (container) {
        event.preventDefault();
        activateTab(container, tab, false);
      }
      return;
    }
    if (finished && globalThis.summaryKit?.click(element)) {
      event.preventDefault();
      report();
      return;
    }
    const action = element.closest("[data-summary-action]");
    if (!action) return;
    const name = action.getAttribute("data-summary-action");
    if (name !== "copy" && name !== "navigate") return;
    if (action.matches(":disabled, [aria-disabled='true']")) return;
    const payload = action.getAttribute("data-summary-payload") || "";
    if (payload.length === 0 || payload.length > 4000) return;
    event.preventDefault();
    post({ kind: "action", action: name, payload });
  };
  const onKeydown = (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const tab = element?.closest('[role="tab"]');
    if (!tab) return;
    const container = tabContainer(tab);
    if (!container) return;
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    if (target) activateTab(container, target, true);
  };
  const configure = (css) => {
    let style = document.getElementById("summary-theme");
    if (!style) {
      style = document.createElement("style");
      style.id = "summary-theme";
      document.head.appendChild(style);
    }
    style.textContent = String(css || "");
    report();
  };
  const reset = () => {
    root.replaceChildren();
    stack = [{ el: root, name: "#root" }];
    svgDepth = 0;
    contentSent = false;
    lastHeight = -1;
    finished = false;
    report();
  };
  const open = (token) => {
    const original = String(token.name || "");
    const name = original.toLowerCase();
    if (!name || name.charAt(0) === "#" || SKIP.has(name)) return;
    if (name === "html" || name === "head" || name === "body") return;
    let element;
    if (svgDepth > 0 || name === "svg") {
      element = document.createElementNS(SVG, original);
    } else {
      element = document.createElement(original);
    }
    if (token.attrs) {
      for (const pair of token.attrs) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const attr = String(pair[0] || "");
        if (!attr || attr.charAt(0) === " " || attr.indexOf("=") >= 0) continue;
        try {
          element.setAttribute(attr, decode(String(pair[1] == null ? "" : pair[1])));
        } catch {
          // Invalid attribute names from the model are ignored.
        }
      }
    }
    if (name === "script") {
      scriptTypes.set(element, element.getAttribute("type") || "");
      // A connected empty script executes when its streamed text is appended. Keep it
      // inert until finish(), otherwise runScripts() executes the model's code twice.
      element.setAttribute("type", "application/x-liquid-pending");
    }
    current().appendChild(element);
    if (!token.selfClosing && !VOID.has(name)) {
      if (name === "svg") svgDepth += 1;
      stack.push({ el: element, name });
    }
    if (!RAW.has(name) && name !== "template") reveal(element);
    if (!contentSent && name === "img") {
      contentSent = true;
      post({ kind: "content" });
    }
  };
  const close = (token) => {
    const name = String(token.name || "").toLowerCase();
    if (!name) return;
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index].name !== name) continue;
      const removed = stack.splice(index);
      for (const entry of removed) {
        if (entry.name === "svg") svgDepth = Math.max(0, svgDepth - 1);
      }
      break;
    }
  };
  const text = (token) => {
    const value = String(token.value == null ? "" : token.value);
    if (!value) return;
    current().appendChild(document.createTextNode(token.raw === true ? value : decode(value)));
    if (!contentSent && token.raw !== true && value.trim().length > 0) {
      contentSent = true;
      post({ kind: "content" });
    }
  };
  const runScripts = () => {
    for (const script of Array.from(root.querySelectorAll("script"))) {
      const type = (scriptTypes.get(script) ?? script.getAttribute("type") ?? "").trim().toLowerCase();
      if (type && type !== "text/javascript" && type !== "module" && type !== "application/javascript") {
        continue;
      }
      if (script.hasAttribute("src")) continue;
      const copy = document.createElement("script");
      if (type) copy.setAttribute("type", type);
      copy.textContent = script.textContent || "";
      script.replaceWith(copy);
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    stack = [{ el: root, name: "#root" }];
    svgDepth = 0;
    globalThis.summaryKit?.prepare(root);
    runScripts();
    initTabs();
    report();
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.type !== TYPE || data.version !== VERSION) return;
    if (data.kind === "config") {
      configure(data.css);
      return;
    }
    if (data.kind === "reset") {
      reset();
      return;
    }
    if (data.kind === "append" && Array.isArray(data.tokens)) {
      for (const token of data.tokens) {
        if (!token || typeof token !== "object") continue;
        if (token.kind === "open") open(token);
        else if (token.kind === "close") close(token);
        else if (token.kind === "text") text(token);
      }
      report();
      return;
    }
    if (data.kind === "finish") finish();
  });

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  root.addEventListener("input", (event) => {
    if (event.target instanceof Element && globalThis.summaryKit?.input(event.target)) report();
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(report).observe(document.documentElement);
  }
  addEventListener("load", () => {
    report();
    post({ kind: "ready" });
  });
  post({ kind: "ready" });
})();
