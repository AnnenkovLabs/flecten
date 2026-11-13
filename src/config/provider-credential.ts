import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderConfig } from "./schema";

const Credential = z
  .object({
    version: z.literal(1),
    destination: z.string().length(64),
    value: z.string().min(1),
  })
  .strict();

function destination(provider: ProviderConfig): string {
  const url = new URL(provider.baseUrl);
  while (url.pathname.endsWith("/") && url.pathname !== "/")
    url.pathname = url.pathname.slice(0, -1);
  return createHash("sha256")
    .update(JSON.stringify([provider.protocol, url.href, provider.proxy ?? ""]))
    .digest("hex");
}

export function bindProviderCredential(provider: ProviderConfig, value: string): string {
  return JSON.stringify({ version: 1, destination: destination(provider), value });
}

export function readProviderCredential(
  provider: ProviderConfig,
  stored: string | undefined,
): string | undefined {
  if (!stored) return undefined;
  try {
    const credential = Credential.safeParse(JSON.parse(stored));
    if (credential.success && credential.data.destination === destination(provider))
      return credential.data.value;
  } catch {
    // Legacy unbound credentials have no evidence of their original destination.
    // Preserve them in storage; explicit key replacement creates the bound form.
  }
  return undefined;
}
