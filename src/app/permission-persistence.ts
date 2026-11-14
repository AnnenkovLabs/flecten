import { type HarnessConfig, PermissionsConfigSchema } from "../config/schema";
import type { PermissionRule } from "../security/types";
import { redactKnown } from "../util/redact";
import { configSecrets } from "./provider-secrets";
import { sameRule } from "./service-policy";

/** Keep the original config untouched until its atomic save succeeds. */
export function configWithRememberedRules(
  config: HarnessConfig,
  rules: readonly PermissionRule[],
): HarnessConfig | undefined {
  const next = structuredClone(config);
  const section = next.permissions ?? PermissionsConfigSchema.parse({});
  const additions = redactKnown([...rules], configSecrets(config)).filter(
    (rule) => !section.rules.some((known) => sameRule(known, rule)),
  );
  if (!additions.length) return undefined;
  section.rules = [...section.rules, ...additions];
  next.permissions = section;
  return next;
}
