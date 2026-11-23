import { registerCloseConfirmation, registerLocaleIpc } from "./dialog-copy.mjs";
import { productEnv } from "../shared/environment.cjs";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { registerAttachmentIpc } from "./attachments.mjs";
import { watchAgentOutput } from "./agent-output.mjs";
import { resolveAgentLaunch, terminateChildProcess } from "./agent-process.mjs";
import { AgentStartup } from "./agent-startup.mjs";
import { bundledAgent, smokeRenderer } from "./packaged-smoke.mjs";
import { MODULE_FRAME_DOCUMENT } from "./module-frame.mjs";
import { captureWhenLoaded } from "./screenshot.mjs";
import { installSessionLinks } from "./deep-links.mjs";
import { projectSelection, registerProjectIpc } from "./projects.mjs";
import { installUpdateRuntime } from "./update-runtime.mjs";
import { migrateRendererPreferences, preferenceMigrationDocument } from "./renderer-preferences.mjs";
import {
  claimSingleInstance,
  DEFAULT_BOUNDS,
  focusWindow,
  MIN_SIZE,
  preserveUserData,
  rememberBounds,
  restoredBounds,
} from "./window-state.mjs";

const { app, BrowserWindow, WebContentsView, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell } =
  electron;
const require = createRequire(import.meta.url);
const { sameProjectPath } = require("../shared/project-index.cjs");
const { isTrustedSenderUrl, validateAgentCommand } = require("./preload.cjs");

const shellDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = normalize(join(shellDir, ".."));
const uiRoot = normalize(join(repoRoot, "ui/dist"));
const devUrl = productEnv("DEV_URL");
const devOrigin = devUrl ? new URL(devUrl).origin : null;
let agentCwd;
const screenshotPath = process.argv.includes("--shot") ? join(tmpdir(), "flecten-ui.png") : null;
const headless = productEnv("HEADLESS") === "1";
const smoke = productEnv("SMOKE") === "1";
const smokeOut = productEnv("SMOKE_OUT");
const windowActions = new Set(["minimize", "maximize", "close"]);
const commandTypes = new Set(require("./agent-commands.json"));
const automated = headless || smoke || screenshotPath !== null;
preserveUserData(app);
if (process.platform === "win32") app.setAppUserModelId("dev.flecten.app");
if (smoke && smokeOut) app.setPath("userData", join(dirname(smokeOut), "profile"));
let mainWindow = null;
const primary = claimSingleInstance(app, () => focusWindow(mainWindow), automated);
if (!primary) app.exit(0);
const selection = projectSelection(app.getPath("userData"), productEnv("CWD"), process.cwd());
agentCwd = selection.cwd;
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
    scheme: "flecten",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "flecten-summary",
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
  ".ttf": "font/ttf",
  ".woff": "font/woff",
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
  const interactions = await script("summary-interactions.js");
  const runtime = await script("summary-runtime.js");
  summaryShell = [
    "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">",
    '<meta name="color-scheme" content="dark">',
    "<style>html,body{margin:0;max-width:100%;background:transparent}",
    "body{color:#f0efed;font-family:system-ui,sans-serif}#summary-root{max-width:100%}</style>",
    '</head><body><div id="summary-root" class="markdown summary"></div>',
    `<script>${kit}<\/script>`,
    `<script>(() => {\n${interactions}\n${runtime}\n})();<\/script>`,
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
  if (new URL(request.url).pathname === "/profile-migration")
    return preferenceMigrationDocument(request);
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
let agent = null;
const agentStartup = new AgentStartup();
let closeAgentOutput = null;
let smokeAgent = null;
let updateRuntime = null;
let smokeDone = false;
const queued = [];
let pendingSession = null;
const sessionLinks = installSessionLinks({ app, automated, emit: sendToRenderer, focus: () => focusWindow(mainWindow), openProject: (path) => {
  if (sameProjectPath(agentCwd, path)) return false;
  switchProject(path);
  return true;
} });
function switchProject(path, sessionId) {
  agentCwd = selection.select(path);
  pendingSession = sessionId ?? null;
  stopAgent();
  if (mainWindow) {
    sendToRenderer({ type: "project.changed", cwd: agentCwd });
    startAgent();
  }
  return agentCwd;
}

function finishSmoke(result) {
  if (!smoke || smokeDone) return;
  smokeDone = true;
  try {
    if (!smokeOut) throw new Error("FLECTEN_SMOKE_OUT is not set");
    writeFileSync(smokeOut, `${JSON.stringify({ ...result, agent: smokeAgent })}\n`);
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

function startAgent() {
  if (agent) return;
  if (!existsSync(agentCwd)) agentCwd = selection.select(null);
  const launch = resolveAgentLaunch({
    repoRoot,
    resourcesPath: process.resourcesPath,
    devUrl,
    explicitBin: productEnv("AGENT_BIN"),
  });
  if (smoke) smokeAgent = bundledAgent(launch.executable, process.resourcesPath, app.isPackaged);
  const child = spawn(launch.command, launch.args, {
    cwd: agentCwd,
    env: { ...process.env, FLECTEN_CWD: agentCwd, FLECTEN_PROFILE: app.getPath("userData"), FLECTEN_PROJECTLESS: selection.projectless ? "1" : "0", BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    ...launch.options,
  });
  agent = child;

  closeAgentOutput = watchAgentOutput(child, {
    current: () => agent === child,
    message: (message) => {
      agentStartup.note(message);
      sendToRenderer(message);
      if (message.type === "status") {
        updateRuntime?.applyStatus(message);
        sessionLinks.status();
        if (pendingSession) { const id = pendingSession; pendingSession = null; sendToRenderer({ type: "session.open", id }); }
      }
    },
    invalid: () => sendToRenderer({ type: "error", code: "protocol", message: "agent sent invalid JSON" }),
    stderr: (line) => console.error(`[agent] ${line}`),
    failed: (error) => { agent = null; closeAgentOutput = null; sendToRenderer({ type: "agent.exit", code: null, message: error.message }); },
    exited: (code, signal) => { agent = null; closeAgentOutput = null; sendToRenderer({ type: "agent.exit", code, signal }); },
  });

  for (const line of queued.splice(0)) {
    if (child.stdin.writable) child.stdin.write(line);
  }
}

function stopAgent() {
  agentStartup.reset();
  queued.length = 0;
  closeAgentOutput?.();
  closeAgentOutput = null;
  const child = agent;
  agent = null;
  terminateChildProcess(child);
}

function sendToAgent(command) {
  const route = agentStartup.route(command);
  if (route.action === "blocked") {
    if (route.response) sendToRenderer(route.response);
    return;
  }
  if (route.action === "restart") stopAgent();
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
  if (smoke) win.webContents.once("did-finish-load", () => {
    void smokeRenderer(win).then(finishSmoke).catch((error) => {
      console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
    });
  });
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
        : target.protocol === "flecten:" && target.host === "app";
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
    win.loadURL("flecten://app/index.html");
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
ipcMain.handle("flecten:open-external", async (event, value) => {
  if (!isTrustedIpcSender(event) || typeof value !== "string" || value.length > 8192) throw new Error("invalid external URL");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("external URL must use http or https without credentials");
  await shell.openExternal(url.href);
});

ipcMain.handle("flecten:find-in-page", (event, text) => {
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

registerProjectIpc({ ipcMain, dialog, BrowserWindow, isTrusted: isTrustedIpcSender, selection, switchProject,
  refresh: () => sendToRenderer({ type: "projects.changed" }) });

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

app.whenReady().then(async () => {
  if (!primary) return;
  protocol.handle("flecten", handleProtocol);
  protocol.handle("flecten-summary", handleSummaryProtocol);
  protocol.handle("liquid", preferenceMigrationDocument);
  await migrateRendererPreferences(WebContentsView, app.getPath("userData")).catch((error) => {
    console.error("[profile] Could not migrate renderer preferences:", error);
  });
  Menu.setApplicationMenu(null);
  startAgent();
  createWindow();
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
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
      console.error("[smoke] timed out waiting for packaged renderer readiness");
      app.exit(1);
    }, 35_000);
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
  stopAgent();
});
