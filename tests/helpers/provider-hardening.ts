// Shared fixtures for provider hardening tests: servers, temp dirs, catalog cache, SSE bodies, fetch stubs.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../src/errors";
import { resetCatalogCache } from "../../src/providers/catalog";
import { resetRateLimits } from "../../src/providers/rate-limit";
import type { ModelEvent, ModelRequest } from "../../src/providers/types";

export const servers: Array<ReturnType<typeof Bun.serve>> = [];
export const dirs: string[] = [];

export function serve(fetch: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-hardening-"));
  dirs.push(dir);
  return dir;
}

export async function writeCache(cwd: string, name: string, value: unknown): Promise<void> {
  const dir = join(cwd, ".liquid", "cache");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
}

export function request(): ModelRequest {
  return {
    model: "test-model",
    system: "system",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        name: "read",
        description: "read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, limit: { type: "number" } },
          required: ["path"],
        },
      },
    ],
    maxTokens: 100,
  };
}

export async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const output: ModelEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

export function sse(...events: string[]): string {
  return `${events.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
}

export function chatDone(): Response {
  return new Response(sse('{"choices":[{"delta":{"content":"ok"}}]}', "[DONE]"), {
    headers: { "content-type": "text/event-stream" },
  });
}

export async function withFetch<T>(replacement: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export function failureOf(run: () => Promise<unknown>): Promise<HarnessError> {
  return run().then(
    () => {
      throw new Error("expected a failure");
    },
    (error: unknown) => {
      if (error instanceof HarnessError) return error;
      throw error;
    },
  );
}

export async function cleanupProviders(): Promise<void> {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  resetCatalogCache();
  resetRateLimits();
}
