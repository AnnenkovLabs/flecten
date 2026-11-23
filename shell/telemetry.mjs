const MAX_PENDING = 32;

function classifyUpdaterError(message) {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (text.includes("signature")) return "signature";
  if (text.includes("sha512") || text.includes("checksum") || text.includes("hash")) {
    return "checksum";
  }
  if (text.includes("manifest") || text.includes("yaml") || text.includes("yml")) {
    return "manifest";
  }
  if (
    text.includes("net") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("enotfound") ||
    text.includes("http")
  ) {
    return "network";
  }
  return "unknown";
}

export function createShellTelemetry({ sendToAgent, packaged }) {
  const launchTs = Date.now();
  const pending = [];
  let ready = false;
  let channel = "beta";
  let lastUpdaterKey = "";
  let restartCount = 0;

  function emit(event, properties) {
    const payload = { event, properties };
    if (ready) {
      sendToAgent({ type: "telemetry.track", ...payload });
      return;
    }
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(payload);
  }

  function onRendererGone(reason, exitCode) {
    emit("app.crashed", {
      source: "renderer",
      error_name: String(reason || "gone").slice(0, 64),
      ...(typeof exitCode === "number" ? { exit_code: exitCode } : {}),
    });
  }

  function onShellError(kind, extra = {}) {
    emit("shell.error", { kind, ...extra });
  }

  return {
    env() {
      return {
        FLECTEN_LAUNCH_TS: String(launchTs),
        FLECTEN_PACKAGED: packaged ? "1" : "0",
      };
    },
    onStatus(message) {
      if (message?.update?.channel === "stable" || message?.update?.channel === "beta") {
        channel = message.update.channel;
      }
      ready = true;
      for (const item of pending.splice(0)) {
        sendToAgent({ type: "telemetry.track", ...item });
      }
    },
    onAgentExit(code, signal) {
      ready = false;
      if (code === 0 && !signal) return;
      restartCount += 1;
      emit("app.crashed", {
        source: "sidecar",
        restart_count: restartCount,
        ...(typeof code === "number" ? { exit_code: code } : {}),
        ...(typeof signal === "string" && signal.length > 0 ? { signal: signal.slice(0, 32) } : {}),
      });
    },
    onRendererGone,
    onShellError,
    attachWindow(win) {
      let frozenAt = 0;
      win.webContents.on("render-process-gone", (_event, details) =>
        onRendererGone(details.reason, details.exitCode),
      );
      win.webContents.on("did-fail-load", (_event, errorCode, _desc, _url, isMainFrame) => {
        if (isMainFrame) onShellError("renderer_load_failed", { error_code: errorCode });
      });
      win.on("unresponsive", () => {
        frozenAt = Date.now();
        onShellError("renderer_unresponsive");
      });
      win.on("responsive", () => {
        const duration_ms = frozenAt > 0 ? Math.max(0, Date.now() - frozenAt) : 0;
        frozenAt = 0;
        onShellError("renderer_responsive", { duration_ms });
      });
    },
    onUpdaterStatus(status) {
      if (!status || (status.state !== "available" && status.state !== "downloaded" && status.state !== "error")) {
        return;
      }
      const key = `${status.state}:${status.version ?? ""}:${channel}`;
      if (key === lastUpdaterKey) return;
      lastUpdaterKey = key;
      emit("updater.state", {
        state: status.state,
        channel,
        ...(typeof status.version === "string" && status.version.length > 0
          ? { target_version: status.version.slice(0, 32) }
          : {}),
        ...(status.state === "error" ? { error_kind: classifyUpdaterError(status.message) } : {}),
      });
    },
    onDeepLink() {
      emit("app.deep_link", { kind: "session" });
    },
  };
}
