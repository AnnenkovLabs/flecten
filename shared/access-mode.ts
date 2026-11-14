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

/** One choice controls both approval policy and the actual execution boundary. */
export const ACCESS_MODES: Record<
  AccessMode,
  { permissions: PermissionFields; sandbox: { enabled: boolean; allowNetwork: boolean } }
> = {
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
    sandbox: { enabled: true, allowNetwork: true },
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
    sandbox: { enabled: true, allowNetwork: true },
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

type AccessSettings = {
  permissions?: PermissionFields | undefined;
  sandbox?: { enabled: boolean; allowNetwork: boolean } | undefined;
};

export function activeAccessMode(config: AccessSettings): ActiveAccessMode {
  for (const mode of AccessModeSchema.options) {
    const preset = ACCESS_MODES[mode];
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
export function applyAccessMode(config: AccessSettings, mode: AccessMode): void {
  if (!config.permissions || !config.sandbox)
    throw new Error("Access settings must be loaded before choosing a mode");
  Object.assign(config.permissions, ACCESS_MODES[mode].permissions);
  Object.assign(config.sandbox, ACCESS_MODES[mode].sandbox);
}
