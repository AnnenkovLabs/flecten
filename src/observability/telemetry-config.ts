import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { productEnv } from "../../shared/environment.cjs";
import type { HarnessConfig } from "../config/schema";
import { atomicWrite } from "../util/atomic";

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

// Injected by `bun build --compile --env=FLECTEN_BUILD_*` during release packaging.
const BUILD_POSTHOG_KEY = (process.env.FLECTEN_BUILD_POSTHOG_API_KEY ?? "").trim();
const BUILD_POSTHOG_HOST = (process.env.FLECTEN_BUILD_POSTHOG_HOST ?? "").trim();
export const BUILD_COMMIT = (process.env.FLECTEN_BUILD_COMMIT ?? "").trim();

const DistinctIdFileSchema = z.object({
  schemaVersion: z.literal(1),
  distinctId: z.string().min(8).max(128),
  createdAt: z.string(),
});

export interface ResolvedPostHogSettings {
  enabled: boolean;
  disabledByEnv: boolean;
  configured: boolean;
  active: boolean;
  apiKey: string;
  host: string;
  batchUrl: string | undefined;
  urlError: string | undefined;
}

export function isTelemetryDisabledByEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const doNotTrack = (env.DO_NOT_TRACK ?? "").trim().toLowerCase();
  if (doNotTrack === "1" || doNotTrack === "true" || doNotTrack === "yes") return true;

  const override = (productEnv("TELEMETRY", env) ?? "").trim().toLowerCase();
  if (override === "0" || override === "false" || override === "off" || override === "no") {
    return true;
  }
  if (override === "1" || override === "true" || override === "on") return false;

  if (productEnv("HEADLESS", env) === "1" || productEnv("SMOKE", env) === "1") return true;
  if (env.CI === "true" || env.CI === "1" || env.NODE_ENV === "test" || env.BUN_ENV === "test") {
    return true;
  }
  return false;
}

export function resolvePostHogBatchUrl(
  rawHost: string,
): { ok: true; host: string; batchUrl: string } | { ok: false; host: string; error: string } {
  let url: URL;
  try {
    url = new URL(rawHost);
  } catch {
    return { ok: false, host: rawHost, error: "Telemetry host is not a valid URL" };
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) {
    return { ok: false, host: rawHost, error: "Telemetry requires HTTPS or a local endpoint" };
  }
  if (url.username || url.password) {
    return { ok: false, host: rawHost, error: "Telemetry host must not embed credentials" };
  }
  const cleanPath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const host = cleanPath ? `${url.origin}${cleanPath}` : url.origin;
  const batchPath =
    cleanPath.endsWith("/batch") || cleanPath.endsWith("/capture")
      ? `${cleanPath}/`
      : `${cleanPath}/batch/`;
  return { ok: true, host, batchUrl: `${url.origin}${batchPath}` };
}

export function resolvePostHogSettings(
  config: HarnessConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedPostHogSettings {
  const enabled = config.telemetry?.enabled ?? true;
  const disabledByEnv = isTelemetryDisabledByEnv(env);
  const apiKey =
    (productEnv("POSTHOG_API_KEY", env) ?? env.POSTHOG_API_KEY ?? "").trim() || BUILD_POSTHOG_KEY;
  const rawHost =
    config.telemetry?.endpoint?.trim() ||
    (productEnv("POSTHOG_HOST", env) ?? env.POSTHOG_HOST ?? "").trim() ||
    BUILD_POSTHOG_HOST ||
    DEFAULT_POSTHOG_HOST;
  const url = resolvePostHogBatchUrl(rawHost);
  const configured = apiKey.length > 0 && url.ok;
  return {
    enabled,
    disabledByEnv,
    configured,
    active: enabled && !disabledByEnv && configured,
    apiKey,
    host: url.host,
    batchUrl: url.ok ? url.batchUrl : undefined,
    urlError: url.ok ? undefined : url.error,
  };
}

export function distinctIdPath(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const profile = productEnv("PROFILE", env)?.trim();
  return profile
    ? join(profile, "telemetry-id.json")
    : join(cwd, ".flecten", "diagnostics", "telemetry-id.json");
}

export async function loadOrCreateDistinctId(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const path = distinctIdPath(cwd, env);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    const parsed = DistinctIdFileSchema.safeParse(raw);
    if (parsed.success) return parsed.data.distinctId;
  } catch {
    // Missing or unreadable file creates a fresh anonymous identifier below.
  }
  const distinctId = `anon_${crypto.randomUUID()}`;
  const payload = {
    schemaVersion: 1 as const,
    distinctId,
    createdAt: new Date().toISOString(),
  };
  await atomicWrite(path, `${JSON.stringify(payload, null, 2)}\n`, 0o600).catch(() => undefined);
  return distinctId;
}
