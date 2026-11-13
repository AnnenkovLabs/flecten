import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { normalizeUpdateSettings } from "../shared/update-settings.cjs";
import { githubUpdateProvider } from "./github-update-provider.mjs";
import { signedUpdateProvider } from "./signed-update-provider.mjs";
import { trustedUpdateKey } from "./update-signature.mjs";
import {
  backgroundCheckDelayMs,
  parseUpdateUrl,
  SETTINGS_CHECK_DELAY_MS,
  STARTUP_CHECK_DELAY_MS,
  updateChannel,
} from "./update-policy.mjs";

const require = createRequire(import.meta.url);

export const UPDATER_EVENTS = [
  "checking-for-update",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "error",
];

function versionOf(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  const version = payload.version;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

function percentOf(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const percent = Number(payload.percent);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function messageOf(payload) {
  const message =
    payload instanceof Error
      ? payload.message
      : typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && typeof payload.message === "string"
          ? payload.message
          : "update failed";
  return message.slice(0, 500);
}

export function mapUpdaterEvent(event, payload) {
  switch (event) {
    case "checking-for-update":
      return { state: "checking", enabled: true };
    case "update-available":
      return { state: "available", enabled: true, version: versionOf(payload) };
    case "update-not-available":
      return { state: "idle", enabled: true };
    case "download-progress":
      return { state: "downloading", enabled: true, percent: percentOf(payload) };
    case "update-downloaded":
      return { state: "downloaded", enabled: true, version: versionOf(payload) };
    case "error":
      return { state: "error", enabled: true, message: messageOf(payload) };
    default:
      return null;
  }
}

function failedStatus(error) {
  return { state: "error", enabled: true, message: messageOf(error) };
}

function pinnedKey() {
  try {
    return readFileSync(new URL("./update-public-key.pem", import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("This build has no pinned update signing key. Updates are disabled.");
    throw error;
  }
}

/**
 * Signed update loop: periodic checks, optional background download, install on
 * quit or on explicit restart. Timers are injectable so tests drive the schedule.
 */
export function createUpdater({ source, emit, settings, automated = false }, dependencies = {}) {
  let current = normalizeUpdateSettings(settings);
  let status = { state: "idle", enabled: true };
  let failures = 0;
  let checking = false;
  let disposed = false;
  let timer = null;
  const timers = dependencies.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };

  const publish = (next) => {
    if (!next) return status;
    status = next;
    emit(status);
    return status;
  };

  let activeSource = null;
  if (source?.kind === "feed") {
    const url = parseUpdateUrl(source.url);
    if (!url) {
      status = { state: "error", enabled: true, message: "update URL is invalid" };
      return idleController(status);
    }
    activeSource = { kind: "feed", url };
  } else if (source?.kind === "github") {
    activeSource = { kind: "github", owner: source.owner, repo: source.repo };
  } else {
    status = { state: "idle", enabled: false };
    return idleController(status);
  }

  let autoUpdater;
  let key;
  try {
    key = trustedUpdateKey(dependencies.publicKey ?? pinnedKey());
    autoUpdater = dependencies.updater ?? require("electron-updater").autoUpdater;
  } catch (error) {
    status = failedStatus(error);
    return idleController(status);
  }

  const configureFeed = (target) => {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = current.installOnQuit;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.channel = updateChannel(current.channel);
    if (target.kind === "feed") {
      autoUpdater.setFeedURL({ provider: "custom", updateProvider: signedUpdateProvider(key, dependencies.fetch), url: target.url });
    } else {
      autoUpdater.setFeedURL({ provider: "custom", updateProvider: githubUpdateProvider(key, dependencies.githubApiRoot), owner: target.owner, repo: target.repo });
    }
  };

  try {
    configureFeed(activeSource);
  } catch (error) {
    status = failedStatus(error);
    return idleController(status);
  }

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delay) => {
    clearTimer();
    if (disposed || automated || !current.autoCheck) return;
    if (status.state === "checking" || status.state === "downloading" || status.state === "downloaded") return;
    timer = timers.setTimeout(() => {
      timer = null;
      return runCheck();
    }, delay);
  };

  const download = async () => {
    if (status.state !== "available") return status;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      publishAndPlan(failedStatus(error));
    }
    return status;
  };

  const publishAndPlan = (next) => {
    if (!next) return status;
    const previous = status.state;
    publish(next);
    if (next.state === "error" && previous !== "error") failures += 1;
    if (next.state === "idle" || next.state === "available") failures = 0;
    if (next.state === "available" && current.autoDownload) void download();
    if (next.state !== previous || next.state === "error") schedule(backgroundCheckDelayMs(failures));
    return status;
  };

  const runCheck = async () => {
    if (disposed || checking) return status;
    if (status.state === "downloading" || status.state === "downloaded") return status;
    checking = true;
    clearTimer();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publishAndPlan(failedStatus(error));
    } finally {
      checking = false;
    }
    return status;
  };

  const listeners = UPDATER_EVENTS.map((event) => {
    const handler = (payload) => publishAndPlan(mapUpdaterEvent(event, payload));
    autoUpdater.on(event, handler);
    return [event, handler];
  });

  const install = () => {
    if (status.state !== "downloaded") {
      return {
        ...status,
        message: status.state === "error" ? status.message : "update is not downloaded",
      };
    }
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      return publish(failedStatus(error));
    }
    return status;
  };

  const apply = ({ source: nextSource, settings: nextSettings }) => {
    if (disposed) return status;
    const next = normalizeUpdateSettings(nextSettings);
    let target = null;
    if (nextSource?.kind === "feed") {
      const url = parseUpdateUrl(nextSource.url);
      if (url) target = { kind: "feed", url };
    } else if (nextSource?.kind === "github") {
      target = { kind: "github", owner: nextSource.owner, repo: nextSource.repo };
    }
    if (!target) return publishAndPlan({ state: "error", enabled: true, message: "update URL is invalid" });
    const feedChanged =
      JSON.stringify(target) !== JSON.stringify(activeSource) ||
      updateChannel(next.channel) !== updateChannel(current.channel);
    current = next;
    autoUpdater.autoInstallOnAppQuit = current.installOnQuit;
    if (feedChanged) {
      activeSource = target;
      try {
        configureFeed(target);
        failures = 0;
        publishAndPlan({ state: "idle", enabled: true });
      } catch (error) {
        publishAndPlan(failedStatus(error));
      }
    }
    schedule(SETTINGS_CHECK_DELAY_MS);
    return status;
  };

  const dispose = () => {
    disposed = true;
    clearTimer();
    for (const [event, handler] of listeners) autoUpdater.removeListener(event, handler);
  };

  schedule(STARTUP_CHECK_DELAY_MS);

  return {
    state: () => status,
    check: runCheck,
    download,
    install,
    apply,
    dispose,
  };
}

function idleController(status) {
  return {
    state: () => status,
    check: async () => status,
    download: async () => status,
    install: () => status,
    apply: () => status,
    dispose: () => undefined,
  };
}