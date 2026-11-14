import { AccessModeSchema, applyAccessMode } from "../../shared/access-mode";
import { type HarnessConfig, PermissionsConfigSchema, SandboxConfigSchema } from "../config/schema";

export function configWithAccessMode(config: HarnessConfig, mode: unknown): HarnessConfig {
  const parsed = AccessModeSchema.parse(mode);
  const next = structuredClone(config);
  next.permissions ??= PermissionsConfigSchema.parse({});
  next.sandbox ??= SandboxConfigSchema.parse({});
  applyAccessMode(next, parsed);
  return next;
}
