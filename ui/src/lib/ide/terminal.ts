import {
  type IdeTerminalAction,
  type IdeTerminalResponse,
  IdeTerminalResponseSchema,
} from "../../../../shared/terminal";
import { requestAgent, sendAgent } from "../desktop";

export interface TerminalCommandOptions {
  id?: string;
  shell?: string;
  cwd?: string;
  title?: string;
  cursor?: number;
  data?: string;
  cols?: number;
  rows?: number;
}

export async function terminalCommand(
  action: IdeTerminalAction,
  input: TerminalCommandOptions = {},
): Promise<IdeTerminalResponse> {
  const response = await requestAgent({ type: "ide.terminal", action, ...input }, 15_000);
  return IdeTerminalResponseSchema.parse(response.terminal);
}

/** Fire-and-forget write or resize for instant zero-round-trip interactive responsiveness. */
export function terminalSend(
  action: "write" | "resize",
  input: { id?: string; data?: string; cols?: number; rows?: number },
): boolean {
  return sendAgent({ type: "ide.terminal", action, ...input, noReply: true });
}
