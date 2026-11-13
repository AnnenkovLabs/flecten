import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

interface RpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

function enabled(name: string): boolean {
  return process.env[name] === "1";
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const dynamic = enabled("MCP_TEST_DYNAMIC");
const catalogs = enabled("MCP_TEST_CATALOGS");
const elicitation = enabled("MCP_TEST_ELICIT");
const failOnceFile = process.env.MCP_TEST_FAIL_ONCE_FILE;

if (enabled("MCP_TEST_STDERR")) {
  process.stderr.write(`mcp fixture stderr ${"x".repeat(9000)}\n`);
}

const baseTools = [
  {
    name: "echo",
    title: "Echo",
    description: "Return the supplied text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "fail",
    description: "Always fail",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "write",
    description: "Pretend to write",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "huge",
    description: "Has an oversized input schema",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string", description: "x".repeat(25_000) } },
      additionalProperties: false,
    },
  },
  ...(dynamic
    ? [
        {
          name: "notify",
          description: "Change the tool list and notify the client",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ]
    : []),
  ...(elicitation
    ? [
        {
          name: "ask",
          description: "Ask the client for structured input",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ]
    : []),
];

const dynamicTool = {
  name: "dynamic",
  description: "Added after tools/list_changed",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

const resources = [
  {
    uri: "file:///doc",
    name: "Doc",
    description: "A test document",
    mimeType: "text/plain",
  },
];

const prompts = [
  {
    name: "greet",
    description: "Greeting prompt",
    arguments: [{ name: "name", required: true }],
  },
];

let dynamicToolAdded = false;
let nextServerRequestId = 9000;
const pendingElicitations = new Map<number, string | number>();

function tools(): unknown[] {
  return dynamicToolAdded ? [...baseTools, dynamicTool] : baseTools;
}

function respondWithElicitationResult(message: RpcMessage): boolean {
  if (message.id === undefined || typeof message.method === "string") return false;
  const pending = pendingElicitations.get(Number(message.id));
  if (pending === undefined) return false;
  pendingElicitations.delete(Number(message.id));
  write({
    jsonrpc: "2.0",
    id: pending,
    result: {
      content: [
        {
          type: "text",
          text: `elicitation: ${JSON.stringify(message.error ?? message.result)}`,
        },
      ],
      isError: false,
    },
  });
  return true;
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line) as RpcMessage;
  if (respondWithElicitationResult(request)) return;
  if (typeof request.method !== "string") return;

  if (request.method === "initialize") {
    if (failOnceFile !== undefined && !existsSync(failOnceFile)) {
      writeFileSync(failOnceFile, "failed");
      write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: "fail once by request" },
      });
      return;
    }
    const capabilities: Record<string, unknown> = {
      tools: { listChanged: dynamic },
    };
    if (catalogs) {
      capabilities.resources = {};
      capabilities.prompts = {};
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities,
        serverInfo: { name: "test-server", version: "1.0.0" },
        instructions: "Use echo for tests.",
      },
    });
    return;
  }
  if (request.method === "notifications/initialized") return;
  if (request.method === "tools/list") {
    write({ jsonrpc: "2.0", id: request.id, result: { tools: tools() } });
    return;
  }
  if (request.method === "resources/list") {
    write({ jsonrpc: "2.0", id: request.id, result: { resources } });
    return;
  }
  if (request.method === "resources/templates/list") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resourceTemplates: [{ uriTemplate: "file:///{name}", name: "Doc by name" }],
      },
    });
    return;
  }
  if (request.method === "resources/read") {
    const uri = (request.params as { uri?: string } | undefined)?.uri;
    if (uri !== "file:///doc") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `unknown resource ${String(uri)}` },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [{ uri, mimeType: "text/plain", text: `document ${"content ".repeat(400)}` }],
      },
    });
    return;
  }
  if (request.method === "prompts/list") {
    write({ jsonrpc: "2.0", id: request.id, result: { prompts } });
    return;
  }
  if (request.method === "prompts/get") {
    const params = request.params as
      | { name?: string; arguments?: Record<string, string> }
      | undefined;
    if (params?.name !== "greet") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `unknown prompt ${String(params?.name)}` },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        description: "Greeting prompt",
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Hello ${params.arguments?.name ?? ""}` },
          },
        ],
      },
    });
    return;
  }
  if (request.method === "tools/call") {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    if (params.name === "echo") {
      const text = String(params.arguments?.text ?? "");
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: `echo: ${text}` }],
          structuredContent: { text },
          isError: false,
        },
      });
      return;
    }
    if (params.name === "fail") {
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: "expected failure" }], isError: true },
      });
      return;
    }
    if (params.name === "notify") {
      dynamicToolAdded = true;
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: "tools changed" }], isError: false },
      });
      return;
    }
    if (params.name === "ask") {
      nextServerRequestId += 1;
      const serverRequestId = nextServerRequestId;
      pendingElicitations.set(serverRequestId, request.id ?? "unknown");
      write({
        jsonrpc: "2.0",
        id: serverRequestId,
        method: "elicitation/create",
        params: {
          message: "What is your name?",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: "wrote nothing" }], isError: false },
    });
    return;
  }
  write({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `unknown method: ${request.method}` },
  });
});
lines.on("close", () => process.exit(0));
