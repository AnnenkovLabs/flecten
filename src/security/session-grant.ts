import { z } from "zod";
import { canonicalPath } from "../util/canonical-path";
import { permissionPath, permissionRequestKey } from "./permission-request-key";
import type { PermissionRequest } from "./types";

const identity = { owner: z.string().min(1), policy: z.string().regex(/^[a-f0-9]{64}$/) };
/** Only canonical scopes and hashes are journaled. Command contents and secrets stay out. */
export const SessionGrantSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("directory"),
      path: z.string().min(1),
      cwd: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...identity,
      kind: z.literal("exact"),
      requestKey: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type SessionGrant = z.infer<typeof SessionGrantSchema>;

export function sessionGrantFor(
  request: PermissionRequest & { sessionId: string },
  policy: string,
): SessionGrant {
  const identity = { owner: request.sessionId, policy };
  return request.action === "external_path" && request.path
    ? {
        ...identity,
        kind: "directory",
        path: permissionPath(canonicalPath(request.path), request.cwd),
        cwd: permissionPath(request.cwd, request.cwd),
      }
    : { ...identity, kind: "exact", requestKey: permissionRequestKey(request) };
}
