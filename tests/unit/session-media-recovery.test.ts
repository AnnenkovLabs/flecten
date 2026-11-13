import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import type { Event, RunResult } from "../../src/core/types";
import { sessionPaths } from "../../src/store/paths";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PDF = Buffer.from("%PDF-1.4\noriginal-pdf-data\n").toString("base64");
const WAV = Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVE-original-audio-data").toString("base64");
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type RequestBody = { model: string; messages: Array<{ role: string; content: unknown }> };
async function workspace(largeFirstAnswer = false) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-media-history-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const requests: RequestBody[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as RequestBody);
      const content =
        largeFirstAnswer && requests.length === 1 ? "earlier answer ".repeat(5000) : "ok";
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  cleanups.push(async () => {
    server.stop(true);
  });
  const model = {
    context: 128_000,
    output: 1024,
    modalities: { input: ["text", "image", "pdf", "audio"] },
  };
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      conversation: { enabled: false },
      provider: "test",
      model: "media",
      catalog: { autoRefresh: false },
      skills: { sources: [] },
      checkpoints: { shell: false },
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: { media: model, "media-next": model },
        },
        legacy: {
          protocol: "openai-responses",
          baseUrl: `http://127.0.0.1:${server.port}/v1`,
          models: { media: model },
        },
      },
    }),
  );
  await Promise.all([
    writeFile(join(cwd, "image.png"), Buffer.from(PNG, "base64")),
    writeFile(join(cwd, "document.pdf"), Buffer.from(PDF, "base64")),
    writeFile(join(cwd, "audio.wav"), Buffer.from(WAV, "base64")),
    writeFile(join(cwd, "notes.txt"), "original-text-data"),
  ]);
  return { cwd, requests };
}

function expectOriginalMedia(request: RequestBody | undefined): void {
  const payload = JSON.stringify(request);
  expect(payload).toContain(`data:image/png;base64,${PNG}`);
  expect(payload).toContain(`data:application/pdf;base64,${PDF}`);
  expect(payload).toContain(WAV);
  expect(payload).toContain("original-text-data");
  expect(payload).not.toContain("replacement-data");
}

describe("durable session media", () => {
  test("a real app run compacts, reopens, changes model and forks with original image, PDF, audio and text after source changes", async () => {
    const { cwd, requests } = await workspace(true);
    const app = await createAppService(cwd);
    const events: Event[] = [];
    app.session.subscribeStamped((event) => events.push(event));
    let id: string;
    try {
      const first = (await app.session.send({
        type: "run",
        prompt: "older request",
      })) as RunResult;
      id = first.sessionId;
      const sent = (await app.session.send({
        type: "run",
        sessionId: id,
        prompt: "Keep  exact\n",
        attachments: ["image.png", "document.pdf", "audio.wav", "notes.txt"],
      })) as RunResult;
      expect(sent.stopReason).toBe("end");
      expectOriginalMedia(requests.at(-1));
      const compacted = (await app.session.send({ type: "context.compact", sessionId: id })) as {
        compacted: boolean;
      };
      expect(compacted).toMatchObject({ compacted: true });
      await app.session.flush();
      const saved = await app.readSession(id);
      const started = saved.find(
        (event) => event.type === "session.started" && event.prompt === "Keep  exact\n",
      );
      expect(started?.type === "session.started" && started.attachments).toHaveLength(3);
      const renderer = JSON.stringify(events);
      const durable = await readFile(sessionPaths(cwd, id).events, "utf8");
      for (const payload of [renderer, durable, JSON.stringify(saved)]) {
        expect(payload).not.toContain(PNG);
        expect(payload).not.toContain(PDF);
        expect(payload).not.toContain(WAV);
      }
      const artifacts = await readdir(sessionPaths(cwd, id).attachments);
      expect(artifacts).toHaveLength(3);
      if (process.platform !== "win32")
        expect(
          (await stat(join(sessionPaths(cwd, id).attachments, artifacts[0] ?? ""))).mode & 0o777,
        ).toBe(0o600);
    } finally {
      await app.dispose();
    }
    await writeFile(join(cwd, "image.png"), "replacement-data");
    await rm(join(cwd, "document.pdf"));
    await rm(join(cwd, "audio.wav"));
    await writeFile(join(cwd, "notes.txt"), "replacement-data");
    const reopened = await createAppService(cwd);
    try {
      await reopened.setModel({ provider: "test", model: "media-next" });
      const continued = (await reopened.session.send({
        type: "run",
        sessionId: id,
        prompt: "Continue",
      })) as RunResult;
      expect(continued.stopReason).toBe("end");
      expect(requests.at(-1)?.model).toBe("media-next");
      expectOriginalMedia(requests.at(-1));
      const fork = await reopened.forkSession(id);
      await reopened.session.send({ type: "run", sessionId: fork.id, prompt: "Continue fork" });
      expectOriginalMedia(requests.at(-1));
    } finally {
      await reopened.dispose();
    }
  });

  test("queued media and text are captured at send time and survive process restart", async () => {
    const { cwd, requests } = await workspace();
    const app = await createAppService(cwd);
    let id: string;
    try {
      const first = (await app.session.send({ type: "run", prompt: "start" })) as RunResult;
      id = first.sessionId;
      await app.session.send({
        type: "queue.add",
        sessionId: id,
        text: "queued media",
        mode: "steer",
        attachments: ["image.png", "document.pdf", "audio.wav", "notes.txt"],
      });
      const queue = await readFile(sessionPaths(cwd, id).queue, "utf8");
      expect(queue).toContain("attachmentSnapshot");
      expect(queue).not.toContain(PNG);
    } finally {
      await app.dispose();
    }
    for (const name of ["image.png", "document.pdf", "audio.wav", "notes.txt"])
      await writeFile(join(cwd, name), "replacement-data");
    const reopened = await createAppService(cwd);
    try {
      await reopened.session.send({ type: "run", sessionId: id, prompt: "continue" });
      expectOriginalMedia(requests.at(-1));
      await reopened.session.flush();
      const steered = (await reopened.readSession(id)).find(
        (event) => event.type === "steer.applied",
      );
      expect(steered?.type === "steer.applied" && steered.attachments).toHaveLength(3);
    } finally {
      await reopened.dispose();
    }
  });

  test("a protocol without audio reports the saved audio incompatibility and a missing artifact never silently disappears", async () => {
    const { cwd, requests } = await workspace();
    const app = await createAppService(cwd);
    let id: string;
    try {
      const first = (await app.session.send({
        type: "run",
        prompt: "listen",
        attachments: ["audio.wav"],
      })) as RunResult;
      id = first.sessionId;
    } finally {
      await app.dispose();
    }
    const reopened = await createAppService(cwd);
    try {
      await reopened.setModel({ provider: "legacy", model: "media" });
      const before = requests.length;
      const result = (await reopened.session.send({
        type: "run",
        sessionId: id,
        prompt: "continue",
      })) as RunResult;
      expect(result.stopReason).toBe("error");
      expect(result.summary).toContain("does not accept audio input");
      expect(requests).toHaveLength(before);
    } finally {
      await reopened.dispose();
    }
    await rm(sessionPaths(cwd, id).attachments, { recursive: true });
    const broken = await createAppService(cwd);
    try {
      await expect(
        broken.session.send({ type: "run", sessionId: id, prompt: "continue" }),
      ).rejects.toThrow("Cannot restore attachment audio.wav");
    } finally {
      await broken.dispose();
    }
  });
});
