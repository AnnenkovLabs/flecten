import { type HarnessConfig, PermissionsConfigSchema, SandboxConfigSchema } from "../config/schema";
import { detectSandbox } from "../security/os-sandbox";
import { permissionPath } from "../security/permission-request-key";
import { SandboxPolicy } from "../security/sandbox";
import type { PermissionRule } from "../security/types";
import type { OsSandboxContext } from "../tools/types";
import { SECRET_MASK, sanitize } from "./provider-secrets";
import { modelOf } from "./provider-state";
import type { AppInfo } from "./service-types";

/** Input modalities of the active model, from the catalog or the model config. */
export function inputModalities(config: HarnessConfig): string[] | undefined {
  const model = modelOf(config);
  const listed = model?.modalities?.input;
  const inputs = new Set(listed ?? ["text"]);
  const flags = [
    ["image", model?.vision],
    ["pdf", model?.pdf],
    ["audio", model?.audio],
  ] as const;
  for (const [modality, enabled] of flags) {
    if (enabled === true) inputs.add(modality);
    else if (enabled === false) inputs.delete(modality);
  }
  return listed?.length || flags.some(([, enabled]) => enabled !== undefined)
    ? [...inputs]
    : undefined;
}

export function permissionRules(config: HarnessConfig): PermissionRule[] {
  const permissions = config.permissions ?? PermissionsConfigSchema.parse({});
  return [
    { action: "read", policy: permissions.read },
    { action: "write", policy: permissions.write },
    { action: "shell", policy: permissions.shell },
    { action: "network", policy: permissions.network },
    { action: "mcp", policy: permissions.mcp },
    { action: "skill", policy: permissions.skill },
    { action: "external_path", policy: permissions.externalPath },
    ...permissions.rules.map((rule) => ({
      action: rule.action,
      policy: rule.policy,
      ...(rule.tool ? { tool: rule.tool } : {}),
      ...(rule.pathPrefix ? { pathPrefix: rule.pathPrefix } : {}),
      ...(rule.risk ? { risk: rule.risk } : {}),
      ...(rule.requestKey ? { requestKey: rule.requestKey } : {}),
      ...(rule.target ? { target: rule.target } : {}),
      ...(rule.cwd ? { cwd: rule.cwd } : {}),
      ...(rule.note ? { note: rule.note } : {}),
      ...(rule.checkpoint !== undefined ? { checkpoint: rule.checkpoint } : {}),
    })),
  ];
}

export function sandboxFor(config: HarnessConfig, cwd: string): SandboxPolicy | undefined {
  const sandbox = config.sandbox ?? SandboxConfigSchema.parse({});
  if (!sandbox.enabled) return undefined;
  return new SandboxPolicy({
    workspaceRoot: cwd,
    allowNetwork: sandbox.allowNetwork,
    readDenyPrefixes: sandbox.readDenyPrefixes,
    writeDenyPrefixes: sandbox.writeDenyPrefixes,
    envAllowlist: sandbox.envAllowlist,
  });
}

export function osSandboxFor(config: HarnessConfig, cwd: string): OsSandboxContext | undefined {
  const sandbox = config.sandbox ?? SandboxConfigSchema.parse({});
  if (!sandbox.enabled) return undefined;
  const deniedPaths = (action: "read" | "write") =>
    (config.permissions?.rules ?? [])
      .filter(
        (rule) =>
          rule.action === action &&
          rule.policy === "deny" &&
          !rule.tool &&
          !rule.requestKey &&
          !rule.risk &&
          rule.pathPrefix !== undefined,
      )
      .flatMap((rule) =>
        rule.pathPrefix === undefined ? [] : [permissionPath(rule.pathPrefix, cwd)],
      );
  return {
    enabled: true,
    allowNetwork: sandbox.allowNetwork,
    workspaceRoot: cwd,
    envAllowlist: sandbox.envAllowlist,
    readOnlyPaths: [
      ...sandbox.writeDenyPrefixes.map((path) => permissionPath(path, cwd)),
      ...deniedPaths("write"),
    ],
    readDeniedPaths: [
      ...sandbox.readDenyPrefixes.map((path) => permissionPath(path, cwd)),
      ...deniedPaths("read"),
    ],
  };
}

export function sandboxStatus(config: HarnessConfig): AppInfo["sandbox"] {
  const enabled = (config.sandbox ?? SandboxConfigSchema.parse({})).enabled;
  const detection = detectSandbox();
  const available = !enabled || detection.kind !== "none";
  return {
    enabled,
    kind: detection.kind,
    available,
    reason: detection.reason,
    ...(enabled && !available
      ? { warning: `OS sandbox включён, но недоступен: ${detection.reason}` }
      : {}),
  };
}

export function sanitizeConfig(config: HarnessConfig): HarnessConfig {
  const view = sanitize(config);
  for (const server of Object.values(view.mcp.servers)) {
    if (!("headers" in server)) continue;
    for (const key of Object.keys(server.headers)) server.headers[key] = SECRET_MASK;
  }
  return view;
}

type RuleKey = Pick<PermissionRule, "action" | "policy"> & {
  checkpoint?: boolean | undefined;
  tool?: string | undefined;
  pathPrefix?: string | undefined;
  risk?: string | undefined;
  requestKey?: string | undefined;
  cwd?: string | undefined;
};

export function sameRule(left: RuleKey, right: RuleKey): boolean {
  return (
    left.action === right.action &&
    left.policy === right.policy &&
    left.checkpoint === right.checkpoint &&
    left.tool === right.tool &&
    left.pathPrefix === right.pathPrefix &&
    left.requestKey === right.requestKey &&
    left.cwd === right.cwd &&
    left.risk === right.risk
  );
}
