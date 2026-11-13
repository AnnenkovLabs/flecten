import { allowedEnv } from "./failure";
import type { SessionOptions } from "./options";

/** Live session configuration shared by built-in and module tool execution. */
export function sessionToolOptions(options: SessionOptions, sessionId: string) {
  return {
    sessionId,
    ...(options.approvalSessionId ? { approvalSessionId: options.approvalSessionId } : {}),
    ...(options.permissionActor ? { permissionActor: options.permissionActor } : {}),
    ...(options.permissionIntent ? { permissionIntent: options.permissionIntent } : {}),
    services: options.modules?.services?.(sessionId),
    cwd: options.cwd,
    logDir: options.logDir(sessionId),
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
