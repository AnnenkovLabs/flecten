const MAX_COMMAND_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 200_000;

function isHttpOrigin(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isTrustedSenderUrl(url, devOrigin = null) {
  if (typeof url !== "string" || url.length === 0) return false;
  try {
    const target = new URL(url);
    if (target.protocol === "liquid:" && target.host === "app") return true;
    return isHttpOrigin(devOrigin) && target.origin === devOrigin;
  } catch {
    return false;
  }
}

function commandBytes(line) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(line).length;
  return line.length;
}

function validateAgentCommand(command, allowedTypes = null, maxBytes = MAX_COMMAND_BYTES) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return "command must be an object";
  }
  if (typeof command.type !== "string" || command.type.length === 0) {
    return "command type is required";
  }
  if (allowedTypes && !allowedTypes.has(command.type)) {
    return `unknown command: ${command.type}`;
  }
  if (command.requestId !== undefined && typeof command.requestId !== "string") {
    return "requestId must be a string";
  }
  if (
    command.prompt !== undefined &&
    (typeof command.prompt !== "string" || command.prompt.length > MAX_PROMPT_CHARS)
  ) {
    return "prompt is invalid or too long";
  }
  let line;
  try {
    line = JSON.stringify(command);
  } catch {
    return "command is not serializable";
  }
  if (typeof line !== "string") return "command is not serializable";
  if (commandBytes(line) > maxBytes) return "command is too large";
  return "";
}

const isRenderer = typeof process !== "undefined" && process.type === "renderer";

if (isRenderer) {
  const { contextBridge, ipcRenderer, webUtils } = require("electron");

  contextBridge.exposeInMainWorld("desktop", {
    setLocale: (locale) => ipcRenderer.send("window:locale", locale),
    control: (action) => ipcRenderer.send("window:control", action),
    chooseProject: () => ipcRenderer.invoke("liquid:choose-project"),
    pickAttachments: () => ipcRenderer.invoke("liquid:pick-attachments"),
    pasteImage: () => ipcRenderer.invoke("liquid:paste-image"),
    describePaths: (paths) => ipcRenderer.invoke("liquid:describe-paths", paths),
    findInPage: (text) => ipcRenderer.invoke("liquid:find-in-page", text),
    openExternal: (url) => ipcRenderer.invoke("liquid:open-external", url),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    },
    agent: {
      send: (command) => {
        if (validateAgentCommand(command) !== "") return;
        ipcRenderer.send("agent:command", command);
      },
      onEvent: (listener) => {
        const handler = (_event, message) => listener(message);
        ipcRenderer.on("agent:event", handler);
        return () => ipcRenderer.removeListener("agent:event", handler);
      },
    },
    updater: {
      state: () => ipcRenderer.invoke("updater:state"),
      check: () => ipcRenderer.invoke("updater:check"),
      download: () => ipcRenderer.invoke("updater:download"),
      install: () => ipcRenderer.invoke("updater:install"),
      onStatus: (listener) => {
        const handler = (_event, status) => listener(status);
        ipcRenderer.on("updater:status", handler);
        return () => ipcRenderer.removeListener("updater:status", handler);
      },
    },
  });
}

module.exports = {
  isTrustedSenderUrl,
  validateAgentCommand,
  MAX_COMMAND_BYTES,
  MAX_PROMPT_CHARS,
};
