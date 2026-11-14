import { realpathSync } from "node:fs";
import { join } from "node:path";

/** Runs inside the packaged renderer, exercising the actual preload bridge both ways. */
async function probeRenderer() {
  const bridge = window.desktop?.agent;
  if (typeof bridge?.send !== "function" || typeof bridge?.onEvent !== "function") {
    throw new Error("packaged preload agent bridge is missing");
  }
  const waitFor = (read) => new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error("packaged composer did not become ready")); }, 10_000);
    function check() {
      const value = read();
      if (!value) return;
      clearTimeout(timer); observer.disconnect(); resolve(value);
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    check();
  });
  await waitFor(() => {
    const prompt = document.querySelector('#prompt[contenteditable="true"]');
    return prompt && prompt.getBoundingClientRect().width > 0;
  });
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("packaged renderer did not receive status")); }, 10_000);
    const unsubscribe = bridge.onEvent((event) => {
      if (event.type !== "status") return;
      clearTimeout(timer); unsubscribe(); resolve(event);
    });
    bridge.send({ type: "hello" });
  });
  const model = await waitFor(() => {
    const title = document.querySelector(".model-button")?.getAttribute("title");
    return title?.endsWith(` · ${status.model}`) ? title : null;
  });
  return { status, renderer: { ready: true, preload: true, composer: true, model } };
}

export function bundledAgent(command, resourcesPath, packaged, platform = process.platform) {
  if (!packaged) throw new Error("packaged smoke requires an installed package");
  const expected = join(resourcesPath, platform === "win32" ? "flecten-agent.exe" : "flecten-agent");
  if (realpathSync(command) !== realpathSync(expected)) {
    throw new Error("packaged smoke must run the bundled agent executable");
  }
  return { command: realpathSync(command), expected: realpathSync(expected), packaged: true };
}

export function smokeRenderer(win) {
  return win.webContents.executeJavaScript(`(${probeRenderer.toString()})()`);
}
