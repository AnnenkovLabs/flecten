import { z } from "zod";
import { HarnessError } from "../errors";
import { redact } from "../util/redact";

/** Operational evidence only. Provider content and request headers never enter this record. */
export const ProviderResponseSchema = z.object({
  protocol: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attemptId: z.string().optional(),
  requested: z.boolean().optional(),
  status: z.enum(["complete", "failed"]),
  outcome: z.string(),
  requestId: z.string().max(256).optional(),
  originalFinishReason: z.string().max(128).optional(),
  frames: z.number().int().nonnegative(),
  invalidFrames: z.number().int().nonnegative(),
  unsupportedFrames: z.number().int().nonnegative(),
  textBytes: z.number().int().nonnegative(),
  reasoningBytes: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  usage: z.enum(["reported", "missing"]),
  terminal: z.boolean(),
  durationMs: z.number().nonnegative(),
});

export type ProviderResponse = z.infer<typeof ProviderResponseSchema>;

export class ProviderResponseError extends HarnessError {
  readonly kind: "bad_request" | "network" | "server";
  readonly retryable: boolean;

  constructor(
    readonly response: ProviderResponse,
    cause?: unknown,
  ) {
    super(
      "provider_failed",
      `provider stream contract failed: ${response.outcome}${response.outcome === "incomplete" ? "; missing [DONE]" : ""}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "ProviderResponseError";
    const kind =
      typeof cause === "object" && cause !== null && "kind" in cause ? cause.kind : undefined;
    this.kind = kind === "network" || kind === "server" ? kind : "bad_request";
    this.retryable = this.kind !== "bad_request";
  }
}

export function responseOfError(error: unknown): ProviderResponse | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
  const parsed = ProviderResponseSchema.safeParse(error.response);
  return parsed.success ? parsed.data : undefined;
}

/** Identifiers are protocol fields, never arbitrary provider text. */
export function responseLabel(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const safe = redact(value);
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(safe) ? safe : "[invalid]";
}
