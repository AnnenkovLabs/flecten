import { z } from "zod";

export const AccessModeSchema = z.enum(["agent", "confirm", "full"]);
export type AccessMode = z.infer<typeof AccessModeSchema>;
export type ActiveAccessMode = AccessMode | "custom";

type Policy = "deny" | "auto" | "ask" | "allow";
type PermissionFields = {
  read: Policy;
  write: Policy;
  shell: Policy;
  network: Policy;
  mcp: Policy;
  skill: Policy;
  externalPath: Policy;
  destructive: Policy;
};

/** Returns true when running on Windows (Node/Bun main process or Chromium renderer). */
export function isWindowsPlatform(platform?: string): boolean {
  if (platform !== undefined) return platform === "win32";
  const nodePlatform = (globalThis as { process?: { platform?: unknown } }).process?.platform;
  if (typeof nodePlatform === "string") return nodePlatform === "win32";
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    return navigator.userAgent.includes("Windows");
  }
  return false;
}

/** OS process sandboxing defaults off on Windows until native AppContainer isolation lands. */
export function defaultSandboxEnabled(platform?: string): boolean {
  return !isWindowsPlatform(platform);
}

export function accessModes(
  platform?: string,
): Record<
  AccessMode,
  { permissions: PermissionFields; sandbox: { enabled: boolean; allowNetwork: boolean } }
> {
  const isolate = defaultSandboxEnabled(platform);
  return {
    agent: {
      permissions: {
        read: "allow",
        write: "allow",
        shell: "allow",
        network: "allow",
        mcp: "allow",
        skill: "allow",
        externalPath: "ask",
        destructive: "ask",
      },
      sandbox: { enabled: isolate, allowNetwork: true },
    },
    confirm: {
      permissions: {
        read: "allow",
        write: "ask",
        shell: "ask",
        network: "allow",
        mcp: "ask",
        skill: "allow",
        externalPath: "ask",
        destructive: "ask",
      },
      sandbox: { enabled: isolate, allowNetwork: true },
    },
    full: {
      permissions: {
        read: "allow",
        write: "allow",
        shell: "allow",
        network: "allow",
        mcp: "allow",
        skill: "allow",
        externalPath: "allow",
        destructive: "allow",
      },
      sandbox: { enabled: false, allowNetwork: true },
    },
  };
}

/** One choice controls both approval policy and the actual execution boundary. */
export const ACCESS_MODES = accessModes();

type AccessSettings = {
  permissions?: PermissionFields | undefined;
  sandbox?: { enabled: boolean; allowNetwork: boolean } | undefined;
};

export function activeAccessMode(config: AccessSettings, platform?: string): ActiveAccessMode {
  const presets = accessModes(platform);
  for (const mode of AccessModeSchema.options) {
    const preset = presets[mode];
    if (
      Object.entries(preset.permissions).every(
        ([field, policy]) => config.permissions?.[field as keyof PermissionFields] === policy,
      ) &&
      config.sandbox?.enabled === preset.sandbox.enabled &&
      config.sandbox.allowNetwork === preset.sandbox.allowNetwork
    )
      return mode;
  }
  return "custom";
}

/** Keep explicit rules, protected paths, environment and approval deadlines intact. */
export function applyAccessMode(config: AccessSettings, mode: AccessMode, platform?: string): void {
  if (!config.permissions || !config.sandbox)
    throw new Error("Access settings must be loaded before choosing a mode");
  const preset = accessModes(platform)[mode];
  Object.assign(config.permissions, preset.permissions);
  Object.assign(config.sandbox, preset.sandbox);
}
