import { registerCloseConfirmation, registerLocaleIpc } from "./dialog-copy.mjs";
import { productEnv } from "../shared/environment.cjs";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { registerAttachmentIpc } from "./attachments.mjs";
import { MODULE_FRAME_DOCUMENT } from "./module-frame.mjs";
import { captureWhenLoaded } from "./screenshot.mjs";
import { installSessionLinks } from "./deep-links.mjs";
import { installUpdateRuntime } from "./update-runtime.mjs";
import {
  claimSingleInstance,
  DEFAULT_BOUNDS,
  focusWindow,
  MIN_SIZE,
  preserveUserData,
  rememberBounds,
  restoredBounds,
} from "./window-state.mjs";

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell } =
  electron;
const require = createRequire(import.meta.url);
const { isTrustedSenderUrl, validateAgentCommand } = require("./preload.cjs");

const shellDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = normalize(join(shellDir, ".."));
const uiRoot = normalize(join(repoRoot, "ui/dist"));
const devUrl = productEnv("DEV_URL");
const devOrigin = devUrl ? new URL(devUrl).origin : null;
let agentCwd = productEnv("CWD") || process.cwd();
const screenshotPath = process.argv.includes("--shot") ? join(tmpdir(), "liquid-ui.png") : null;
const headless = productEnv("HEADLESS") === "1";
const smoke = productEnv("SMOKE") === "1";
const smokeOut = productEnv("SMOKE_OUT");
const windowActions = new Set(["minimize", "maximize", "close"]);
const commandTypes = new Set(require("./agent-commands.json"));
const automated = headless || smoke || screenshotPath !== null;
preserveUserData(app);
function isTrustedIpcSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (!event.sender || event.sender.id !== mainWindow.webContents.id) return false;
  if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  return isTrustedSenderUrl(event.senderFrame.url, devOrigin);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "liquid",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "liquid-summary",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

nativeTheme.themeSource = "dark";

const contentTypeByExtension = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function isInsideUi(filePath) {
  return filePath === uiRoot || filePath.startsWith(`${uiRoot}${sep}`);
}

// Keep in sync with SUMMARY_CSP in ui/src/lib/markdown/sanitize.ts.
const SUMMARY_CSP =
  "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'none'";
let summaryShell = "";

async function summaryShellDocument() {
  if (summaryShell.length > 0) return summaryShell;
  const script = async (name) =>
    (await readFile(join(shellDir, name), "utf8")).replaceAll("</script", "<\\/script");
  const kit = await script("summary-kit.js");
  const runtime = await script("summary-runtime.js");
  summaryShell = [
    "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">",
    '<meta name="color-scheme" content="dark">',
    "<style>html,body{margin:0;max-width:100%;background:transparent}",
    "body{color:#f0efed;font-family:system-ui,sans-serif}#summary-root{max-width:100%}</style>",
    '</head><body><div id="summary-root" class="markdown summary"></div>',
    `<script>${kit}<\/script>`,
    `<script>${runtime}<\/script>`,
    "</body></html>",
  ].join("");
  return summaryShell;
}

async function handleSummaryProtocol(request) {
  const url = new URL(request.url);
  if (!["shell", "module"].includes(url.host) || (url.pathname !== "/" && url.pathname !== "")) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(url.host === "module" ? MODULE_FRAME_DOCUMENT : await summaryShellDocument(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SUMMARY_CSP,
      "cache-control": "no-store",
    },
  });
}

async function handleProtocol(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const filePath = normalize(join(uiRoot, pathname));
  if (!isInsideUi(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const data = await readFile(filePath);
    const contentType = contentTypeByExtension[extname(filePath).toLowerCase()];
    return new Response(data, {
      headers: contentType ? { "content-type": contentType } : undefined,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

let interfaceLocale = "en";
let mainWindow = null;
let agent = null;
let updateRuntime = null;
let smokeDone = false;
const queued = [];
const sessionLinks = installSessionLinks({ app, automated, emit: sendToRenderer, focus: () => focusWindow(mainWindow), openProject: (path) => {
  if (agentCwd === path) return false;
  agentCwd = path;
  if (agent) { agent.kill(); agent = null; }
  if (mainWindow) { sendToRenderer({ type: "project.changed", cwd: path }); startAgent(); }
  return true;
} });

function finishSmoke(status) {
  if (!smoke || smokeDone) return;
  smokeDone = true;
  try {
    if (!smokeOut) throw new Error("FLECTEN_SMOKE_OUT is not set");
    writeFileSync(smokeOut, `${JSON.stringify(status)}\n`);
    app.quit();
  } catch (error) {
    console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  }
}

function sendToRenderer(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:event", message);
  }
}

function sendUpdaterStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updater:status", status);
  }
}

function resolveAgent() {
  const script = join(repoRoot, "src/app/server.ts");
  if (devUrl) return { command: "bun", args: ["run", script] };
  const explicit = productEnv("AGENT_BIN");
  if (explicit && existsSync(explicit)) return { command: explicit, args: [] };
  const names = process.platform === "win32" ? ["flecten-agent.exe", "flecten-agent"] : ["flecten-agent"];
  for (const name of names) {
    const packaged = process.resourcesPath ? join(process.resourcesPath, name) : null;
    if (packaged && existsSync(packaged)) return { command: packaged, args: [] };
    const built = join(repoRoot, "dist", name);
    if (existsSync(built)) return { command: built, args: [] };
  }
  return { command: "bun", args: ["run", script] };
}

function startAgent() {
  if (agent) return;
  const { command, args } = resolveAgent();
  const child = spawn(command, args, {
    cwd: agentCwd,
    env: { ...process.env, FLECTEN_CWD: agentCwd, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  agent = child;

  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim().length === 0) return;
    try {
      const message = JSON.parse(line);
      if (smoke && message.type === "status") finishSmoke(message);
      sendToRenderer(message);
      if (message.type === "status") {
        updateRuntime?.applyStatus(message);
        sessionLinks.status();
      }
    } catch {
      sendToRenderer({ type: "error", code: "protocol", message: "agent sent invalid JSON" });
    }
  });

  createInterface({ input: child.stderr }).on("line", (line) => {
    console.error(`[agent] ${line}`);
  });

  // A replaced agent (another project was opened) ends quietly: only the current one reports.
  child.on("error", (error) => {
    if (agent !== child) return;
    sendToRenderer({ type: "agent.exit", code: null, message: error.message });
  });

  child.on("exit", (code, signal) => {
    if (agent !== child) return;
    agent = null;
    sendToRenderer({ type: "agent.exit", code, signal });
  });

  for (const line of queued.splice(0)) {
    if (child.stdin.writable) child.stdin.write(line);
  }
}

function sendToAgent(command) {
  const line = `${JSON.stringify(command)}\n`;
  if (agent?.stdin.writable) {
    agent.stdin.write(line);
  } else {
    queued.push(line);
    startAgent();
  }
}

function createWindow() {
  // Tests and screenshots start at the reference size; people get the window they left.
  const boundsFile = join(app.getPath("userData"), "window-state.json");
  const bounds = automated
    ? { ...DEFAULT_BOUNDS, maximized: false }
    : restoredBounds(boundsFile, screen.getAllDisplays());
  const { maximized, ...placement } = bounds;
  const win = new BrowserWindow({
    ...placement,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    frame: false,
    skipTaskbar: headless,
    backgroundColor: "#171717",
    title: "Flecten",
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(shellDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(headless ? { backgroundThrottling: false } : {}),
    },
  });

  mainWindow = win;
  registerCloseConfirmation(win, dialog, () => interfaceLocale);
  const trustedMedia = (contents, details) =>
    contents === win.webContents && details.isMainFrame &&
    isTrustedSenderUrl(details.requestingUrl ?? contents.getURL(), devOrigin);
  win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    trustedMedia(contents, details) &&
    ((permission === "media" && details.mediaType === "audio") || permission === "clipboard-sanitized-write"),
  );
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const audioOnly = details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio";
    callback(trustedMedia(contents, details) &&
      ((permission === "media" && audioOnly) || permission === "clipboard-sanitized-write"));
  });
  if (!automated) rememberBounds(win, boundsFile);
  win.once("ready-to-show", () => {
    if (!headless) {
      if (maximized) win.maximize();
      win.show();
      return;
    }
    win.showInactive();
    win.minimize();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim().length > 0) {
      template.push({ role: "copy" });
    }
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: win });
  });
  win.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      allowed = devOrigin
        ? target.origin === devOrigin
        : target.protocol === "liquid:" && target.host === "app";
    } catch {
      allowed = false;
    }
    if (!allowed) event.preventDefault();
  });

  if (devUrl) {
    win.loadURL(devUrl);
    if (productEnv("DEVTOOLS") === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    win.loadURL("liquid://app/index.html");
  }

  if (screenshotPath) captureWhenLoaded(win, screenshotPath, () => app.quit());

  return win;
}

registerAttachmentIpc({
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  isTrusted: isTrustedIpcSender,
});

// /search in the composer: Chromium find-in-page highlights matches; an empty query clears them.
ipcMain.handle("liquid:open-external", async (event, value) => {
  if (!isTrustedIpcSender(event) || typeof value !== "string" || value.length > 8192) throw new Error("invalid external URL");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("external URL must use http or https without credentials");
  await shell.openExternal(url.href);
});

ipcMain.handle("liquid:find-in-page", (event, text) => {
  if (!isTrustedIpcSender(event)) return 0;
  const contents = event.sender;
  if (typeof text !== "string" || text.length === 0) {
    contents.stopFindInPage("clearSelection");
    return 0;
  }
  return new Promise((resolve) => {
    const done = (matches) => {
      clearTimeout(timer);
      contents.removeListener("found-in-page", onFound);
      resolve(matches);
    };
    const onFound = (_event, result) => {
      if (result.finalUpdate) done(result.matches ?? 0);
    };
    const timer = setTimeout(() => done(0), 2000);
    contents.on("found-in-page", onFound);
    contents.findInPage(text.slice(0, 500));
  });
});

ipcMain.handle("liquid:choose-project", async (event) => {
  if (!isTrustedIpcSender(event)) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  const selected = result.canceled ? undefined : result.filePaths[0];
  if (!selected) return null;
  agentCwd = selected;
  if (agent) {
    agent.kill();
    agent = null;
  }
  startAgent();
  sendToRenderer({ type: "project.changed", cwd: selected });
  return selected;
});

registerLocaleIpc(ipcMain, isTrustedIpcSender, (locale) => { interfaceLocale = locale; });
ipcMain.on("window:control", (event, action) => {
  if (!isTrustedIpcSender(event) || !windowActions.has(action)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  if (action === "minimize") win.minimize();
  if (action === "maximize") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
  if (action === "close") win.close();
});

ipcMain.on("agent:command", (event, command) => {
  if (!isTrustedIpcSender(event)) return;
  const issue = validateAgentCommand(command, commandTypes);
  if (issue !== "") {
    const requestId = typeof command?.requestId === "string" ? command.requestId : undefined;
    sendToRenderer(
      requestId
        ? { type: "response", requestId, ok: false, error: issue }
        : { type: "error", code: "invalid_input", message: issue },
    );
    return;
  }
  sendToAgent(command);
  if (command.type === "hello") sessionLinks.listening();
});

const primary = claimSingleInstance(app, () => focusWindow(mainWindow), automated);
if (!primary) app.quit();

app.whenReady().then(() => {
  if (!primary) return;
  protocol.handle("liquid", handleProtocol);
  protocol.handle("liquid-summary", handleSummaryProtocol);
  Menu.setApplicationMenu(null);
  startAgent();
  createWindow();
  updateRuntime = installUpdateRuntime({
    ipcMain,
    isTrusted: isTrustedIpcSender,
    emit: sendUpdaterStatus,
    automated,
    packaged: app.isPackaged,
  });
  if (smoke) {
    setTimeout(() => {
      if (smokeDone) return;
      console.error("[smoke] timed out waiting for status");
      app.exit(1);
    }, 20_000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (updateRuntime) {
    updateRuntime.dispose();
    updateRuntime = null;
  }
  if (agent) {
    agent.kill("SIGTERM");
    agent = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
