import { MODULE_FRAME_BRIDGE } from "./frame-bridge";
import { moduleThemeTokens } from "./styles";

export function moduleFrame(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.documentElement.lang = globalThis.document.documentElement.lang || "en";
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  document.head.prepend(policy);
  const style = document.createElement("style");
  style.textContent = `:root{${Object.entries(moduleThemeTokens())
    .map(([name, value]) => `${name}:${value}`)
    .join(
      ";",
    )}}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-variant-numeric:tabular-nums}*{box-sizing:border-box}`;
  document.head.append(style);
  const script = document.createElement("script");
  script.textContent = MODULE_FRAME_BRIDGE;
  document.head.prepend(script);
  document.head.prepend(policy);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
