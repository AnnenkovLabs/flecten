import { z } from "zod";
import { isObject } from "../util/json";
import { redact } from "../util/redact";

const IdSchema = z.union([z.string(), z.number()]);
const ResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: IdSchema,
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});
const NotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
const RequestSchema = NotificationSchema.extend({ id: IdSchema });

export type MessageOutcome = { matched: false } | { matched: true; value: unknown };
export interface MessageHandlers {
  notification(value: { method: string; params?: unknown }): void;
  request?(method: string, params: unknown, signal: AbortSignal): Promise<unknown>;
  reply(value: Record<string, unknown>): Promise<void>;
  error(message: string, details?: { code?: number; data?: unknown; cause?: unknown }): Error;
}

/** Server requests on a POST SSE response share the same bounded lifetime as that tool call. */
export async function readMcpMessage(
  value: unknown,
  requestId: number,
  signal: AbortSignal,
  handlers: MessageHandlers,
): Promise<MessageOutcome> {
  if (!isObject(value) || value.jsonrpc !== "2.0") return { matched: false };
  if (typeof value.method === "string") {
    if ("id" in value) {
      const request = RequestSchema.safeParse(value);
      if (!request.success)
        throw handlers.error("MCP server sent an invalid request", { cause: request.error });
      const { id, method, params } = request.data;
      let reply: Record<string, unknown>;
      try {
        if (!handlers.request) throw new Error("MCP server requests are not enabled");
        reply = { jsonrpc: "2.0", id, result: await handlers.request(method, params, signal) };
      } catch (error) {
        reply = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: redact(error instanceof Error ? error.message : String(error)),
          },
        };
      }
      await handlers.reply(reply);
    } else {
      const notification = NotificationSchema.safeParse(value);
      if (notification.success) handlers.notification(notification.data);
    }
    return { matched: false };
  }
  const response = ResponseSchema.safeParse(value);
  if (!response.success)
    throw handlers.error("MCP server sent an invalid JSON-RPC response", { cause: response.error });
  if (String(response.data.id) !== String(requestId)) return { matched: false };
  if (response.data.error !== undefined)
    throw handlers.error(redact(response.data.error.message), {
      code: response.data.error.code,
      data: response.data.error.data,
    });
  if (!("result" in value))
    throw handlers.error("MCP server sent a JSON-RPC response without result or error");
  return { matched: true, value: response.data.result };
}
