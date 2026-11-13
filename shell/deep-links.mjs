import { isAbsolute } from "node:path";
import { statSync } from "node:fs";

const SCHEMES = new Set(["flecten:", "liquid-harness:"]);

/** Links select an existing task; they never contain commands, prompts or executable paths. */
export function parseSessionLink(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!SCHEMES.has(url.protocol) || url.hostname !== "session" || url.username || url.password || url.port || url.hash) return null;
    if ([...url.searchParams.keys()].some((key) => key !== "project")) return null;
    if (url.searchParams.getAll("project").length !== 1) return null;
    const id = decodeURIComponent(url.pathname.slice(1));
    if (!id || id.length > 128 || [...id].some((char) => !"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-".includes(char))) return null;
    const project = url.searchParams.get("project");
    if (!project || !isAbsolute(project) || project.includes("\0")) return null;
    return { id, project };
  } catch { return null; }
}

export function installSessionLinks({ app, automated, openProject, emit, focus, argv = process.argv }) {
  let pending = null;
  let listening = false;
  const existing = (value) => {
    const link = parseSessionLink(value);
    if (!link) return null;
    try { return statSync(link.project).isDirectory() ? link : null; } catch { return null; }
  };
  const receive = (value) => {
    const link = existing(value);
    if (!link) return false;
    pending = link;
    openProject(link.project);
    focus();
    if (listening) { pending = null; emit({ type: "session.open", id: link.id }); }
    return true;
  };
  app.on("open-url", (event, value) => { event.preventDefault(); receive(value); });
  app.on("second-instance", (_event, args) => { for (const value of args ?? []) if (receive(value)) break; });
  // Register only installed apps: development and hidden test launches do not change OS defaults.
  if (!automated && app.isPackaged) {
    app.setAsDefaultProtocolClient("flecten");
    app.setAsDefaultProtocolClient("liquid-harness");
  }
  for (const value of argv) {
    const link = existing(value);
    if (link) { pending = link; openProject(link.project); break; }
  }
  return {
    listening() { listening = true; },
    status() {
      if (!listening || !pending) return;
      const { id } = pending;
      pending = null;
      emit({ type: "session.open", id });
    },
  };
}
