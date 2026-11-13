import { z } from "zod";
import { requestAgent } from "../desktop";

const Snapshot = z.object({
  data: z.string(),
  cursor: z.number().int().nonnegative(),
  epoch: z.number().int(),
  reset: z.boolean(),
  running: z.boolean(),
});
export async function terminalCommand(
  action: "read" | "write" | "resize" | "restart" | "stop",
  input: { cursor?: number; data?: string; cols?: number; rows?: number } = {},
): Promise<z.infer<typeof Snapshot>> {
  const response = await requestAgent({ type: "ide.terminal", action, ...input }, 15_000);
  return Snapshot.parse(response.terminal);
}
