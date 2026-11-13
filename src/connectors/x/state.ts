import { z } from "zod";

const Grant = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  scope: z.string(),
});

const Pending = z.object({
  clientState: z.string(),
  codeChallenge: z.string(),
  upstreamVerifier: z.string(),
  browserBinding: z.string(),
  expiresAt: z.number(),
});

const Code = z.object({
  codeChallenge: z.string(),
  grant: Grant,
  expiresAt: z.number(),
});

const Session = z.object({
  grant: Grant,
  accessTokenHash: z.string(),
  refreshTokenHash: z.string(),
  expiresAt: z.number(),
});

export const VaultState = z.object({
  version: z.literal(1),
  pending: z.record(z.string(), Pending),
  codes: z.record(z.string(), Code),
  sessions: z.record(z.string(), Session),
});

export type XGrant = z.infer<typeof Grant>;
export type OAuthState = z.infer<typeof VaultState>;

export function emptyState(): OAuthState {
  return { version: 1, pending: {}, codes: {}, sessions: {} };
}
