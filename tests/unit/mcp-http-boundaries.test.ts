import { describe, expect, test } from "bun:test";
import { McpHttpError, StreamableHttpClient } from "../../src/mcp/http";
import { withFetch } from "../helpers/provider-hardening";

describe("MCP HTTP response boundaries", () => {
  test.each(["rpc-error", "listener-error", "result"])(
    "cancels open SSE after %s",
    async (kind) => {
      let cancelled = false;
      const message =
        kind === "rpc-error"
          ? { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "rpc-error" } }
          : kind === "listener-error"
            ? { jsonrpc: "2.0", method: "notifications/tools/list_changed" }
            : { jsonrpc: "2.0", id: 1, result: { tools: [] } };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`));
        },
        cancel() {
          cancelled = true;
        },
      });
      const client = new StreamableHttpClient({ url: "https://mcp.example.test", timeoutMs: 1000 });
      client.onNotification(() => {
        throw new Error("listener-error");
      });
      try {
        await withFetch(
          (async () =>
            new Response(body, {
              headers: { "content-type": "text/event-stream" },
            })) as unknown as typeof fetch,
          async () => {
            if (kind === "result") {
              expect(await client.request("tools/list")).toEqual({ tools: [] });
            } else {
              await expect(client.request("tools/list")).rejects.toThrow(kind);
            }
            expect(cancelled).toBe(true);
          },
        );
      } finally {
        await client.close();
      }
    },
  );

  test("does not send credentials to a redirected origin under Bun fetch", async () => {
    let receivedHeaders: Headers | undefined;
    const destination = Bun.serve({
      port: 0,
      async fetch(request) {
        receivedHeaders = request.headers;
        const message = (await request.json()) as { id: number };
        return Response.json({ jsonrpc: "2.0", id: message.id, result: {} });
      },
    });
    const source = Bun.serve({
      port: 0,
      fetch() {
        return Response.redirect(destination.url, 307);
      },
    });
    const client = new StreamableHttpClient({
      url: source.url.toString(),
      headers: { "x-custom-secret": "fixture-only-key" },
      retry: { attempts: 1 },
    });
    try {
      const result = await client.request("tools/list").catch((error: unknown) => error);
      expect(receivedHeaders?.get("x-custom-secret")).toBeUndefined();
      expect(result).toBeInstanceOf(McpHttpError);
      expect((result as Error).message).toContain("redirect");
    } finally {
      await client.close();
      source.stop(true);
      destination.stop(true);
    }
  });
});
