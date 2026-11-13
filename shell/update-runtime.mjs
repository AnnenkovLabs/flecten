import { productEnv } from "../shared/environment.cjs";
import { normalizeUpdateSettings } from "../shared/update-settings.cjs";
import { createUpdater } from "./updater.mjs";
import { updateSource } from "./update-policy.mjs";

const UNTRUSTED = { state: "idle", enabled: false };

/** Owns the updater instance: source resolution, config from sidecar status, IPC. */
export function installUpdateRuntime({ ipcMain, isTrusted, emit, automated, packaged }) {
  let updater = null;
  let fallback = { state: "idle", enabled: false };
  let settings = normalizeUpdateSettings(undefined);

  function sync() {
    const source = updateSource(settings, productEnv("UPDATE_URL"), packaged);
    if (source.kind === "none" || (source.kind === "feed" && !source.url)) {
      if (updater) {
        updater.dispose();
        updater = null;
      }
      fallback =
        source.kind === "feed"
          ? { state: "error", enabled: true, message: "update URL is invalid" }
          : { state: "idle", enabled: false };
      return;
    }
    if (updater) {
      updater.apply({ source, settings });
      return;
    }
    updater = createUpdater({ source, emit, settings, automated });
  }

  function applyStatus(message) {
    const next = normalizeUpdateSettings(message.update);
    if (JSON.stringify(next) !== JSON.stringify(settings)) {
      settings = next;
      sync();
    }
  }

  const state = () => (updater ? updater.state() : fallback);

  ipcMain.handle("updater:state", (event) => (isTrusted(event) ? state() : UNTRUSTED));
  ipcMain.handle("updater:check", async (event) => {
    if (!isTrusted(event)) return UNTRUSTED;
    return updater ? updater.check() : fallback;
  });
  ipcMain.handle("updater:download", async (event) => {
    if (!isTrusted(event)) return UNTRUSTED;
    return updater ? updater.download() : fallback;
  });
  ipcMain.handle("updater:install", (event) => {
    if (!isTrusted(event)) return UNTRUSTED;
    return updater ? updater.install() : fallback;
  });

  sync();

  return {
    applyStatus,
    dispose: () => {
      if (updater) {
        updater.dispose();
        updater = null;
      }
    },
  };
}