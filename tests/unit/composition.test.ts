import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createAppService } from "../../src/app/service";
import { HarnessConfigSchema, McpServerConfigSchema } from "../../src/config/schema";
import { createSession } from "../../src/core/session/session";
import type { RunResult } from "../../src/core/types";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool, type OsSandboxContext } from "../../src/tools/types";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-composition-"));
  dirs.push(dir);
  return dir;
}

function sse(payloads: unknown[]): Response {
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MCP transport config", () => {
  test("parses HTTP and stdio servers from the shared parser", () => {
    const http = McpServerConfigSchema.parse({
      url: "https://mcp.example.test/mcp",
      headers: { Authorization: "Bearer token" },
      oauth: { clientId: "client", scopes: ["read"] },
      timeoutMs: 5000,
    });
    expect(http).toMatchObject({
      url: "https://mcp.example.test/mcp",
      headers: { Authorization: "Bearer token" },
      oauth: { clientId: "client", scopes: ["read"] },
      timeoutMs: 5000,
      enabled: true,
    });
    expect("command" in http).toBe(false);

    const stdio = McpServerConfigSchema.parse({
      command: "bun",
      args: ["server.ts"],
      env: { TOKEN: "value" },
      protocol: "legacy",
    });
    expect(stdio).toMatchObject({
      command: "bun",
      args: ["server.ts"],
      env: { TOKEN: "value" },
      protocol: "legacy",
      enabled: true,
    });

    expect(() => McpServerConfigSchema.parse({ url: "https://x.test", command: "bun" })).toThrow();
    expect(() => McpServerConfigSchema.parse({ url: "file:///tmp/socket" })).toThrow();
  });

  test("keeps both transports in a full harness config", () => {
    const parsed = HarnessConfigSchema.parse({
      mcp: {
        servers: {
          remote: { url: "https://mcp.example.test/mcp", enabled: false },
          local: { command: "bun", enabled: false },
        },
      },
    });
    expect(parsed.mcp.servers.remote).toMatchObject({ url: "https://mcp.example.test/mcp" });
    expect(parsed.mcp.servers.local).toMatchObject({ command: "bun" });
  });
});

describe("session sandbox context", () => {
  test("passes osSandbox to every tool context", async () => {
    const cwd = await tempDir();
    const osSandbox: OsSandboxContext = {
      enabled: true,
      allowNetwork: false,
      workspaceRoot: cwd,
      envAllowlist: ["PATH"],
    };
    let seen: OsSandboxContext | undefined;
    const probe = defineTool({
      name: "probe",
      description: "records the sandbox context",
      schema: z.object({}),
      execute: async (_args, context) => {
        seen = context.osSandbox;
        return { ok: true, output: "probe ok" };
      },
    });
    const provider = scriptedProvider([
      [
        { type: "tool_call", id: "call-probe", name: "probe", args: {} },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "finished" },
        { type: "done", reason: "end" },
      ],
    ]);
    const session = createSession({
      cwd,
      provider,
      providerId: "scripted",
      model: "scripted-1",
      tools: new ToolRegistry([probe], { limits }),
      system: "test",
      limits,
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 4, continuations: 0, parallelTools: false },
      osSandbox,
      logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
    });

    const result = (await session.send({ type: "run", prompt: "probe" })) as RunResult;
    expect(result.stopReason).toBe("end");
    expect(seen).toEqual(osSandbox);
  });
});

describe("app service composition", () => {
  test("wires memory, subagents, sandbox status and secret masking", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, ".liquid"), { recursive: true });
    await writeFile(
      join(cwd, ".liquid", "memory.json"),
      JSON.stringify({
        version: 1,
        records: [
          {
            id: "mem_1",
            text: "Memory preference: keep answers short",
            kind: "preference",
            source: { sessionId: "s-1" },
            weight: 0.9,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            tags: ["memory"],
          },
        ],
      }),
      "utf8",
    );

    const requests: Array<{ system: string; messages: Array<{ role: string; content: unknown }> }> =
      [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        const messages = body.messages ?? [];
        const systemMessage = messages.find((message) => message.role === "system");
        const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
        requests.push({ system, messages });

        if (system.includes("You are Explore")) {
          return sse([
            {
              choices: [
                {
                  delta: {
                    content: JSON.stringify({
                      summary: "mapped the project",
                      files: ["src/app/service.ts"],
                      findings: ["composition is wired"],
                      openQuestions: [],
                    }),
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { usage: { prompt_tokens: 20, completion_tokens: 10 } },
          ]);
        }

        if (messages.some((message) => message.role === "tool")) {
          return sse([
            { choices: [{ delta: { content: "Parent finished." } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { usage: { prompt_tokens: 30, completion_tokens: 5 } },
          ]);
        }

        return sse([
          { choices: [{ delta: { content: "Delegating to explore." } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-task",
                      function: {
                        name: "task",
                        arguments: JSON.stringify({
                          agent: "explore",
                          prompt: "map the project",
                          context: "composition test",
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          { usage: { prompt_tokens: 25, completion_tokens: 12 } },
        ]);
      },
    });
    servers.push(server);

    await writeFile(
      join(cwd, "flecten.config.json"),
      JSON.stringify({
        useDefaults: false,
        conversation: { enabled: false },
        provider: "fake",
        model: "fake-1",
        providers: {
          fake: {
            protocol: "openai-chat",
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            headers: { Authorization: "Bearer provider-secret" },
            models: { "fake-1": { name: "Fake" } },
          },
        },
        permissions: {
          read: "allow",
          write: "allow",
          shell: "allow",
          network: "allow",
          mcp: "allow",
          skill: "allow",
          externalPath: "allow",
          rules: [],
        },
        sandbox: {
          enabled: true,
          allowNetwork: false,
          readDenyPrefixes: [],
          writeDenyPrefixes: [],
          envAllowlist: ["PATH"],
        },
        mcp: {
          servers: {
            remote: {
              url: "https://mcp.example.test/mcp",
              headers: { Authorization: "Bearer mcp-secret" },
              timeoutMs: 5000,
              enabled: false,
            },
            local: {
              command: "bun",
              args: [],
              env: { LOCAL_TOKEN: "local-secret" },
              enabled: false,
            },
          },
        },
      }),
      "utf8",
    );

    const service = await createAppService(cwd);
    try {
      const payload = service.settings();
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("provider-secret");
      expect(serialized).not.toContain("mcp-secret");
      expect(serialized).not.toContain("local-secret");
      expect(payload.config.mcp.servers.remote).toMatchObject({
        url: "https://mcp.example.test/mcp",
        headers: { Authorization: "[saved]" },
      });
      expect(payload.config.mcp.servers.local).toMatchObject({
        command: "bun",
        env: { LOCAL_TOKEN: "[saved]" },
      });
      expect(payload.info.memory.records).toBe(1);
      expect(payload.info.sandbox.enabled).toBe(true);
      expect(payload.info.sandbox.available).toBe(payload.info.sandbox.kind !== "none");
      expect(payload.info.sandbox.warning !== undefined).toBe(!payload.info.sandbox.available);

      const result = (await service.session.send({
        type: "run",
        prompt: "check memory preference",
      })) as RunResult;
      expect(result.stopReason).toBe("end");

      // Legacy records have unverified provenance, so migration never promotes them into context.
      const parent = requests[0];
      expect(parent?.system).not.toContain("Memory preference: keep answers short");
      const firstUser = String(
        parent?.messages.find((message) => message.role === "user")?.content ?? "",
      );
      expect(firstUser).toBe("check memory preference");
      expect(
        parent?.messages.some((message) =>
          String(message.content).includes("Memory preference: keep answers short"),
        ),
      ).toBe(false);
      const child = requests.find((request) => request.system.includes("You are Explore"));
      expect(child).toBeDefined();
      const final = requests[requests.length - 1];
      expect(
        final?.messages.some(
          (message) =>
            message.role === "tool" && String(message.content).includes("mapped the project"),
        ),
      ).toBe(true);

      await service.saveSettings({ config: payload.config });
      const saved = JSON.parse(await readFile(join(cwd, "flecten.config.json"), "utf8")) as {
        mcp: { servers: { remote: { headers: Record<string, string> } } };
      };
      expect(saved.mcp.servers.remote.headers.Authorization).toBe("Bearer mcp-secret");
    } finally {
      await service.dispose();
    }
  });
});
