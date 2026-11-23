import { z } from "zod";

export const TelemetryStatusSchema = z.object({
  enabled: z.boolean(),
  active: z.boolean(),
  disabledByEnv: z.boolean(),
  configured: z.boolean(),
  host: z.string(),
  distinctId: z.string().optional(),
});
export type TelemetryStatus = z.infer<typeof TelemetryStatusSchema>;

export const TELEMETRY_LOCALES = ["en", "zh-Hans", "pt-BR", "es", "ja", "uk", "ru"] as const;
export type TelemetryLocale = (typeof TELEMETRY_LOCALES)[number];

export const TELEMETRY_SCREENS = [
  "agent",
  "ide",
  "twin",
  "settings",
  "subagent",
  "module",
] as const;
export type TelemetryScreen = (typeof TELEMETRY_SCREENS)[number];

export const TELEMETRY_SURFACES = [
  "thread",
  "changes",
  "history",
  "terminal",
  "worker",
  "subagent",
  "module",
  "ide",
  "twin",
  "settings:general",
  "settings:appearance",
  "settings:models",
  "settings:providers",
  "settings:permissions",
  "settings:tools",
  "settings:history",
  "settings:dictionary",
  "settings:mcp",
  "settings:hooks",
  "settings:skills",
  "settings:modules",
  "settings:about",
] as const;
export type TelemetrySurface = (typeof TELEMETRY_SURFACES)[number];

export const TELEMETRY_UI_ACTIONS = [
  "split_toggle",
  "sidebar_toggle",
  "slash_command",
  "summary_navigate",
  "thread_export_md",
  "file_viewer_open",
  "locale_changed",
  "scale_changed",
  "new_task",
  "project_switch",
  "model_picker_open",
] as const;
export type TelemetryUiAction = (typeof TELEMETRY_UI_ACTIONS)[number];

export const TELEMETRY_ACTION_TARGETS = [
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
  "custom",
  "settings",
  "panel",
  "file",
  "models",
  "focus",
  "split",
  "open",
  "close",
  "project",
  "projectless",
  ...TELEMETRY_LOCALES,
] as const;
export type TelemetryActionTarget = (typeof TELEMETRY_ACTION_TARGETS)[number];

export const TelemetryClientEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("ui.screen_viewed"),
    properties: z
      .object({
        screen: z.enum(TELEMETRY_SCREENS),
        surface: z.enum(TELEMETRY_SURFACES),
        layout: z.enum(["focus", "split"]),
        viewport_bucket: z.enum(["compact", "standard", "wide"]),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("ui.action"),
    properties: z
      .object({
        action: z.enum(TELEMETRY_UI_ACTIONS),
        target: z.enum(TELEMETRY_ACTION_TARGETS).optional(),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("ui.error"),
    properties: z
      .object({
        source: z.enum(["window_error", "unhandled_rejection"]),
        error_name: z.string().min(1).max(64),
        screen: z.enum(TELEMETRY_SCREENS).optional(),
        surface: z.enum(TELEMETRY_SURFACES).optional(),
        has_stack: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("ui.locale"),
    properties: z
      .object({
        locale: z.enum(TELEMETRY_LOCALES),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("updater.state"),
    properties: z
      .object({
        state: z.enum(["available", "downloaded", "installed", "error"]),
        channel: z.enum(["stable", "beta"]),
        target_version: z.string().min(1).max(32).optional(),
        error_kind: z.enum(["network", "signature", "checksum", "manifest", "unknown"]).optional(),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("app.deep_link"),
    properties: z
      .object({
        kind: z.literal("session"),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("app.crashed"),
    properties: z
      .object({
        source: z.enum(["shell", "renderer", "sidecar"]),
        error_name: z.string().min(1).max(64).optional(),
        exit_code: z.number().int().optional(),
        signal: z.string().min(1).max(32).optional(),
        restart_count: z.number().int().nonnegative().optional(),
      })
      .strict(),
  }),
  z.object({
    event: z.literal("shell.error"),
    properties: z
      .object({
        kind: z.enum([
          "agent_invalid_json",
          "project_locked",
          "startup_failed",
          "renderer_load_failed",
          "renderer_unresponsive",
          "renderer_responsive",
          "ipc_validation_failed",
        ]),
        error_code: z.number().int().optional(),
        duration_ms: z.number().int().nonnegative().optional(),
      })
      .strict(),
  }),
]);

export type TelemetryClientEvent = z.infer<typeof TelemetryClientEventSchema>;

export const TelemetryTrackCommandSchema = TelemetryClientEventSchema.and(
  z.object({
    type: z.literal("telemetry.track"),
  }),
);

export type TelemetryTrackCommand = TelemetryClientEvent & {
  type: "telemetry.track";
};
