import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import type { Event, RunResult } from "../../src/core/types";
import { sessionPaths } from "../../src/store/paths";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
interface Request {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{
    function: { name: string; parameters: { properties: Record<string, unknown> } };
  }>;
}

test("pasted media, focused read, accounting, queue, reopen and native vision use the real app path", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-vision-"));
  const paste = await mkdtemp(join(tmpdir(), "flecten-paste-test-"));
  const path = join(paste, "screenshot.png");
  const requests: Request[] = [];
  let workerCalls = 0;
  let nativeRead = false;
  let nativePath = "local.png";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Request;
      requests.push(body);
      let delta: unknown;
      if (body.model === "cheap-eyes") {
        delta = {
          content: JSON.stringify(body.messages).includes("Inspect the error")
            ? "Focused: the error says permission denied."
            : "Screenshot: a red permission denied error beside the Save button.",
        };
      } else {
        workerCalls++;
        if (body.model === "native" && !nativeRead) {
          nativeRead = true;
          delta = {
            tool_calls: [
              {
                index: 0,
                id: "native-read",
                type: "function",
                function: { name: "read", arguments: JSON.stringify({ path: nativePath }) },
              },
            ],
          };
        } else
          delta =
            workerCalls === 1
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: "read-image",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({
                          path: "local.png",
                          focus: "Inspect the error",
                        }),
                      },
                    },
                  ],
                }
              : { content: "<summary>The screenshot contains a permission error.</summary>" };
      }
      return new Response(
        `data: ${JSON.stringify({
          choices: [
            {
              delta,
              finish_reason:
                body.model !== "cheap-eyes" && workerCalls === 1 ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await writeFile(path, Buffer.from(PNG, "base64"));
  await writeFile(join(cwd, "local.png"), Buffer.from(PNG, "base64"));
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      conversation: { enabled: false },
      provider: "test",
      model: "worker",
      skills: { sources: [] },
      checkpoints: { shell: false },
      sandbox: { enabled: true },
      permissions: { read: "allow" },
      catalog: { autoRefresh: false },
      transport: { retries: 0 },
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: {
            worker: { vision: false, context: 128000, output: 1024, cost: { input: 1, output: 2 } },
            "cheap-eyes": { vision: true, tools: false, cost: { input: 0.1, output: 0.2 } },
            "expensive-eyes": { vision: true, cost: { input: 5, output: 10 } },
            native: { vision: true, context: 128000, output: 1024 },
          },
        },
      },
    }),
  );
  let app: Awaited<ReturnType<typeof createAppService>> | undefined;
  try {
    app = await createAppService(cwd);
    const events: Event[] = [];
    app.session.subscribeStamped((event) => events.push(event));
    const first = (await app.session.send({
      type: "run",
      prompt: "Check  this\n",
      attachments: [path],
    })) as RunResult;
    expect(first.stopReason).toBe("done");
    const readEvent = events.find((event) => event.type === "tool.finished");
    expect(readEvent?.type === "tool.finished" && readEvent.result).toMatchObject({ ok: true });
    const helpers = requests.filter((request) => request.model === "cheap-eyes");
    expect(helpers).toHaveLength(2);
    expect(JSON.stringify(helpers[0])).toContain(`data:image/png;base64,${PNG}`);
    expect(JSON.stringify(helpers[1])).toContain("Inspect the error");
    const workers = requests.filter((request) => request.model === "worker");
    expect(JSON.stringify(workers)).not.toContain(PNG);
    expect(JSON.stringify(workers[0])).toContain("Screenshot: a red permission denied error");
    expect(JSON.stringify(workers[1])).toContain("Focused: the error says permission denied");
    const read = workers[0]?.tools?.find((tool) => tool.function.name === "read");
    expect(read?.function.parameters.properties).toHaveProperty("focus");
    const visionUsage = events.filter(
      (event) => event.type === "usage" && event.purpose === "vision",
    );
    expect(visionUsage).toHaveLength(2);
    expect(first.usage.input).toBe(80);
    expect(first.budget?.spent.costUsd).toBeCloseTo(0.000088);
    await app.session.flush();
    const saved = await app.readSession(first.sessionId);
    const start = saved.find((event) => event.type === "session.started");
    expect(start?.type === "session.started" && start.prompt).toBe("Check  this\n");
    const ref = start?.type === "session.started" ? start.attachments?.[0] : undefined;
    expect(ref).toBeDefined();
    if (!ref) throw new Error("No durable image reference");
    const durablePath = join(sessionPaths(cwd, first.sessionId).attachments, `${ref.id}.bin`);
    expect(JSON.stringify(workers[0])).toContain(durablePath);
    nativePath = durablePath;
    expect(await readFile(durablePath)).toEqual(Buffer.from(PNG, "base64"));
    expect(JSON.stringify(saved)).not.toContain(PNG);

    await app.session.send({
      type: "queue.add",
      sessionId: first.sessionId,
      text: "Queued image",
      mode: "steer",
      attachments: [path],
    });
    await rm(paste, { recursive: true });
    await app.dispose();
    app = await createAppService(cwd);
    const continued = (await app.session.send({
      type: "run",
      sessionId: first.sessionId,
      prompt: "Continue",
    })) as RunResult;
    expect(continued.stopReason).toBe("done");
    expect(JSON.stringify(requests.at(-1))).toContain("Screenshot: a red permission denied error");
    await app.setModel({ provider: "test", model: "native" });
    const nativeEvents: Event[] = [];
    app.session.subscribeStamped((event) => nativeEvents.push(event));
    const native = (await app.session.send({
      type: "run",
      sessionId: first.sessionId,
      prompt: "Look directly",
    })) as RunResult;
    expect(native.stopReason).toBe("done");
    const imageRead = nativeEvents.find(
      (event) => event.type === "tool.finished" && event.call.id === "native-read",
    );
    expect(imageRead?.type === "tool.finished" && imageRead.result).toMatchObject({
      ok: true,
      attachments: [{ mediaType: "image/png" }],
    });
    expect(JSON.stringify(requests.at(-1))).toContain(`data:image/png;base64,${PNG}`);
    expect(
      requests.at(-1)?.tools?.find((tool) => tool.function.name === "read")?.function.parameters
        .properties,
    ).not.toHaveProperty("focus");
  } finally {
    await app?.dispose();
    server.stop(true);
    await rm(cwd, { recursive: true, force: true });
    await rm(paste, { recursive: true, force: true });
  }
});
