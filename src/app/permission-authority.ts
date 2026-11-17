import { join } from "node:path";
import { z } from "zod";
import type { HarnessConfig } from "../config/schema";
import { permissionPolicyKey } from "../security/permission-request-key";
import { atomicWrite } from "../util/atomic";
import { permissionRules } from "./service-policy";
import { destructivePolicy } from "./session-config";

const PolicyRevisionSchema = z
  .object({ fingerprint: z.string(), epoch: z.string().uuid() })
  .strict();

/** A policy change rotates durable authority even if settings are later changed back. */
export async function permissionAuthority(cwd: string, config: HarnessConfig) {
  const policy = { rules: permissionRules(config), destructive: destructivePolicy(config) };
  const fingerprint = permissionPolicyKey(policy);
  const path = join(cwd, ".flecten", "permission-policy.json");
  const file = Bun.file(path);
  const stored = (await file.exists())
    ? PolicyRevisionSchema.safeParse(await file.json())
    : undefined;
  if (stored?.success && stored.data.fingerprint === fingerprint)
    return { ...policy, grantEpoch: stored.data.epoch };
  const epoch = crypto.randomUUID();
  await atomicWrite(path, JSON.stringify({ fingerprint, epoch }), 0o600);
  return { ...policy, grantEpoch: epoch };
}
