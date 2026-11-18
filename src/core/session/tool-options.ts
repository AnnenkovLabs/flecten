import { join } from "node:path";
import { ReadTracker } from "../../tools/util/read-tracker";
import { allowedEnv } from "./failure";
import type { SessionOptions } from "./options";

export function sessionReadsTracker(limit = 64) {
  const bySession = new Map<string, ReadTracker>();
  return (sessionId: string, explicit?: ReadTracker): ReadTracker => {
    if (explicit) return explicit;
    let reads = bySession.get(sessionId);
    if (!reads) {
      reads = new ReadTracker();
      if (bySession.size >= limit) {
        const oldest = bySession.keys().next().value;
        if (oldest !== undefined) bySession.delete(oldest);
      }
      bySession.set(sessionId, reads);
    }
    return reads;
  };
}

/** Live session configuration shared by built-in and module tool execution. */
export function sessionToolOptions(options: SessionOptions, sessionId: string) {
  return {
    sessionId,
    ...(options.taskBudget ? { taskBudget: options.taskBudget } : {}),
    ...(options.approvalSessionId ? { approvalSessionId: options.approvalSessionId } : {}),
    ...(options.permissionActor ? { permissionActor: options.permissionActor } : {}),
    ...(options.permissionIntent ? { permissionIntent: options.permissionIntent } : {}),
    services: options.modules?.services?.(sessionId),
    cwd: options.cwd,
    logDir: options.logDir(sessionId),
    scratchDir: join(options.cwd, ".flecten-scratch", sessionId),
    limits: options.limits,
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
    ...(options.shellCheckpoints ? { shellCheckpoints: options.shellCheckpoints } : {}),
    ...(options.subagentRunnerFactory
      ? { subagentRunnerFactory: options.subagentRunnerFactory }
      : {}),
    ...(options.secrets ? { secrets: options.secrets() } : {}),
    ...(options.osSandbox ? { osSandbox: options.osSandbox } : {}),
    ...(options.sandbox
      ? { sandbox: options.sandbox, env: allowedEnv(options.sandbox.envAllowlist) }
      : {}),
  };
}
