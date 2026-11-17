import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import type { ToolResult } from "../../core/types";
import { isObject } from "../../util/json";
import type { ToolContext } from "../types";
import { resolveToolPath } from "../util/paths";

export const ExpectedOutputSchema = z
  .object({
    path: z.string().min(1),
    minBytes: z.number().int().nonnegative().optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  })
  .strict();
export type ExpectedOutput = z.infer<typeof ExpectedOutputSchema>;

/** Exit status and verified artifacts are separate, typed facts. */
export async function verifyOutputs(
  result: ToolResult,
  outputs: ExpectedOutput[] | undefined,
  cwd: string,
  context: Pick<ToolContext, "signal" | "sandbox" | "permissions" | "sessionId">,
): Promise<ToolResult> {
  if (!result.ok || !outputs?.length) return result;
  const verified: Array<{ path: string; bytes: number; sha256?: string }> = [];
  try {
    for (const output of outputs) {
      context.signal.throwIfAborted();
      const path = resolveToolPath(cwd, output.path);
      const sandbox = await context.sandbox?.checkRead(path);
      if (sandbox && !sandbox.allowed) throw new Error(sandbox.reason);
      const permission = context.permissions?.check({
        action: "read",
        tool: "bash",
        path,
        cwd,
        sessionId: context.sessionId,
        safety: "bounded",
      });
      if (permission?.policy === "deny" || permission?.humanOnly)
        throw new Error(permission.reason);
      const info = await stat(path);
      if (!info.isFile()) throw new Error(`${output.path} is not a regular file`);
      if (info.size < (output.minBytes ?? 0))
        throw new Error(
          `${output.path} has ${info.size} bytes; expected at least ${output.minBytes}`,
        );
      let sha256: string | undefined;
      if (output.sha256) {
        const hash = new Bun.CryptoHasher("sha256");
        for await (const chunk of createReadStream(path, { signal: context.signal }))
          hash.update(chunk);
        sha256 = hash.digest("hex");
        if (sha256 !== output.sha256.toLowerCase())
          throw new Error(`${output.path} SHA-256 does not match`);
      }
      verified.push({ path, bytes: info.size, ...(sha256 ? { sha256 } : {}) });
    }
    return {
      ...result,
      data: { ...(isObject(result.data) ? result.data : {}), verifiedOutputs: verified },
    };
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: `Command exited successfully, but output verification failed: ${error instanceof Error ? error.message : String(error)}`,
      data: {
        ...(isObject(result.data) ? result.data : {}),
        verifiedOutputs: verified,
        outputVerification: "failed",
      },
    };
  }
}
