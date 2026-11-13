import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

function write(id: string | number | undefined, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

const inputSchema = {
  type: "object",
  properties: { response: { type: "string", enum: ["mismatched", "failed", "malformed"] } },
  required: ["response"],
  additionalProperties: false,
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line) as {
    id?: string | number;
    method?: string;
    params?: { arguments?: { response?: string } };
  };
  if (request.method === "initialize") {
    write(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "output-schema-fixture", version: "1.0.0" },
    });
  } else if (request.method === "tools/list") {
    write(request.id, {
      tools: [
        {
          name: "mutate",
          inputSchema,
          outputSchema: {
            type: "object",
            properties: { accepted: { type: "boolean" } },
            required: ["accepted"],
          },
        },
      ],
    });
  } else if (request.method === "tools/call") {
    const response = request.params?.arguments?.response;
    if (response === "failed") {
      write(request.id, { content: [{ type: "text", text: "mutation refused" }], isError: true });
    } else if (response === "malformed") {
      write(request.id, { content: "invalid MCP envelope", isError: false });
    } else {
      appendFileSync(process.env.MCP_TEST_ACTION_LOG ?? "actions.log", "mutation\n");
      write(request.id, {
        content: [{ type: "text", text: "mutation completed" }],
        structuredContent: { accepted: "yes" },
        isError: false,
      });
    }
  }
});
lines.on("close", () => process.exit(0));
