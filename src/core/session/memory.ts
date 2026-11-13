import { join } from "node:path";
import { MemoryRuntime } from "../memory/runtime";
import type { Message } from "../types";
import type { SessionOptions } from "./options";

/** Native background access never creates an approval request. Explicit tools keep normal gates. */
export async function sessionMemoryAllowed(
  options: Pick<SessionOptions, "cwd" | "permissions" | "sandbox">,
  sessionId: string,
  action: "read" | "write",
): Promise<boolean> {
  const path = join(options.cwd, ".liquid", "memory.json");
  const decision = options.permissions?.check({
    action,
    tool: "memory",
    path,
    cwd: options.cwd,
    safety: "bounded",
    sessionId,
  });
  if (decision && decision.policy !== "auto" && decision.policy !== "allow") return false;
  const check = await options.sandbox?.checkMemory(action);
  return check?.allowed ?? true;
}

export function sessionMemory(
  options: Pick<SessionOptions, "memory" | "cwd" | "secrets" | "permissions" | "sandbox">,
  sessionId: string,
  system: string,
  history: Message[],
): MemoryRuntime | undefined {
  if (!options.memory) return undefined;
  return new MemoryRuntime({
    port: options.memory,
    sessionId,
    system,
    messages: () => history,
    secrets: options.secrets?.(),
    automaticRead: () => sessionMemoryAllowed(options, sessionId, "read"),
    automaticWrite: () => sessionMemoryAllowed(options, sessionId, "write"),
  });
}
