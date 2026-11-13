import type { TerminalSession } from "../../terminal/session";
import { RedactionStream } from "../../util/redaction-stream";
import type { ToolContext } from "../types";

/** Same redaction boundary as streamed bash output, including secrets split over PTY chunks. */
export function streamTerminal(session: TerminalSession, context: ToolContext): () => void {
  if (!context.reportOutput) return () => {};
  const redactor = new RedactionStream(context.secrets);
  const unsubscribe = session.onEvent((event) => {
    if (event.type !== "data") return;
    const text = redactor.push(Bun.stripANSI(event.data));
    if (text) context.reportOutput?.(text);
  });
  return () => {
    unsubscribe();
    const tail = redactor.finish();
    if (tail) context.reportOutput?.(tail);
  };
}
