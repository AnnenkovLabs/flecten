import type { ContextMessage } from "../../context";
import type { Message } from "../types";

/** Metadata follows retained message identity. A summary or clipped copy gains no authority. */
const originals = new WeakMap<ContextMessage, Message>();
export function rememberContextMessage(context: ContextMessage, message: Message): void {
  originals.set(context, message);
}
export function originalContextMessage(context: ContextMessage): Message | undefined {
  const original = originals.get(context);
  return original?.content === context.content ? original : undefined;
}
