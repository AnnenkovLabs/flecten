import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/core/session/session";
import { createOpenAiChat } from "../../src/providers/openai-chat";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { runtime } from "../helpers/runtime";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sse(payloads: unknown[]): Response {
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("agent loop over a real provider adapter", () => {
  test("writes a file, then finishes with done", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-agent-"));
    dirs.push(cwd);

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { messages?: Array<{ role: string }> };
        const hasToolResult = (body.messages ?? []).some((message) => message.role === "tool");
        if (!hasToolResult) {
          return sse([
            { choices: [{ delta: { content: "Writing the file." } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-write",
                        function: {
                          name: "write",
                          arguments: JSON.stringify({
                            path: "hello.txt",
                            content: "hello from liquid\n",
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            },
            { usage: { prompt_tokens: 100, completion_tokens: 20 } },
          ]);
        }
        return sse([
          { choices: [{ delta: { content: "Done." } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-done",
                      function: {
                        name: "done",
                        arguments: JSON.stringify({
                          summary: "created hello.txt",
                          evidence: ["hello.txt exists with content"],
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          { usage: { prompt_tokens: 140, completion_tokens: 30 } },
        ]);
      },
    });
    servers.push(server);

    const provider = createOpenAiChat(runtime(`http://127.0.0.1:${server.port}/v1`));
    const session = createSession({
      cwd,
      provider,
      providerId: "local",
      model: "test-model",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "You are a test agent.",
      limits,
      maxOutputTokens: 1000,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 8, continuations: 1, parallelTools: true },
      logDir: (sessionId) => join(cwd, ".liquid", "sessions", sessionId, "logs"),
    });

    const result = (await session.send({ type: "run", prompt: "create hello.txt" })) as {
      pass: boolean;
      stopReason: string;
      turns: number;
    };

    expect(result).toMatchObject({ pass: true, stopReason: "done", turns: 2 });
    expect(await readFile(join(cwd, "hello.txt"), "utf8")).toBe("hello from liquid\n");
  });
});
