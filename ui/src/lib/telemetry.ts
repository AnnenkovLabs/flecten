import type {
  TelemetryActionTarget,
  TelemetryLocale,
  TelemetryScreen,
  TelemetrySurface,
  TelemetryUiAction,
} from "../../../shared/telemetry";
import { sendAgent } from "./desktop";

const SLASH_TARGETS = new Set<string>([
  "undo",
  "redo",
  "checkpoints",
  "terminal",
  "new",
  "clear",
  "permissions",
  "export",
  "model",
  "compact",
  "search",
  "continue",
]);

const AGENT_SURFACES = new Set<string>(["thread", "changes", "history", "terminal", "worker"]);

const MAX_ERRORS_PER_MINUTE = 10;
const ERROR_WINDOW_MS = 60_000;

let lastScreenKey = "";
let currentScreen: TelemetryScreen | undefined;
let currentSurface: TelemetrySurface | undefined;
const errorTimestamps: number[] = [];

function emitTelemetry(command: Parameters<typeof sendAgent>[0]): void {
  if (typeof window === "undefined") return;
  sendAgent(command);
}

export function viewportBucket(width: number): "compact" | "standard" | "wide" {
  if (width < 1200) return "compact";
  if (width <= 1600) return "standard";
  return "wide";
}

export function trackScreen(
  screen: TelemetryScreen,
  surface: TelemetrySurface,
  layout: "focus" | "split",
  viewportWidth: number,
): void {
  const bucket = viewportBucket(viewportWidth);
  const key = `${screen}:${surface}:${layout}:${bucket}`;
  currentScreen = screen;
  currentSurface = surface;
  if (key === lastScreenKey) return;
  lastScreenKey = key;
  emitTelemetry({
    type: "telemetry.track",
    event: "ui.screen_viewed",
    properties: { screen, surface, layout, viewport_bucket: bucket },
  });
}

export function trackAppScreen(state: {
  mode: "agent" | "ide";
  twinOpen: boolean;
  surface: string;
  layout: "focus" | "split";
  viewportWidth: number;
  settingsOpen: boolean;
}): void {
  if (state.settingsOpen) return;
  if (state.surface.startsWith("subagent:")) {
    trackScreen("subagent", "subagent", "focus", state.viewportWidth);
    return;
  }
  if (state.surface.startsWith("module:")) {
    trackScreen("module", "module", "focus", state.viewportWidth);
    return;
  }
  if (state.twinOpen) {
    trackScreen("twin", "twin", "focus", state.viewportWidth);
    return;
  }
  if (state.mode === "ide") {
    trackScreen("ide", "ide", "focus", state.viewportWidth);
    return;
  }
  const surface = (
    AGENT_SURFACES.has(state.surface) ? state.surface : "thread"
  ) as TelemetrySurface;
  trackScreen("agent", surface, state.layout, state.viewportWidth);
}

export function trackUiAction(action: TelemetryUiAction, target?: TelemetryActionTarget): void {
  emitTelemetry({
    type: "telemetry.track",
    event: "ui.action",
    properties: { action, ...(target ? { target } : {}) },
  });
}

export function trackSlashCommand(name: string): void {
  const target = (SLASH_TARGETS.has(name) ? name : "custom") as TelemetryActionTarget;
  trackUiAction("slash_command", target);
}

export function syncTelemetryLocale(locale: TelemetryLocale): void {
  emitTelemetry({
    type: "telemetry.track",
    event: "ui.locale",
    properties: { locale },
  });
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 64);
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    error.name.trim()
  ) {
    return error.name.trim().slice(0, 64);
  }
  return "Error";
}

export function installErrorTelemetry(): () => void {
  if (typeof window === "undefined") return () => {};
  const report = (source: "window_error" | "unhandled_rejection", error: unknown): void => {
    const now = Date.now();
    while (errorTimestamps.length > 0 && now - (errorTimestamps[0] ?? 0) > ERROR_WINDOW_MS) {
      errorTimestamps.shift();
    }
    if (errorTimestamps.length >= MAX_ERRORS_PER_MINUTE) return;
    errorTimestamps.push(now);
    emitTelemetry({
      type: "telemetry.track",
      event: "ui.error",
      properties: {
        source,
        error_name: errorName(error),
        ...(currentScreen ? { screen: currentScreen } : {}),
        ...(currentSurface ? { surface: currentSurface } : {}),
        has_stack: Boolean(error instanceof Error && error.stack),
      },
    });
  };
  const onError = (event: ErrorEvent): void => report("window_error", event.error);
  const onRejection = (event: PromiseRejectionEvent): void =>
    report("unhandled_rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
