import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function appFor(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  cleanups.push(async () => server.stop(true));
  const cwd = await mkdtemp(join(tmpdir(), "liquid-voice-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await Bun.write(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "speech",
      model: "test-model",
      providers: {
        speech: {
          protocol: "openai-chat",
          baseUrl: `${server.url}v1`,
          apiKey: "test-voice-secret",
          headers: { "X-Speech-Test": "yes", "Content-Type": "application/json" },
          models: { "test-model": { tools: true } },
        },
      },
      voice: {
        engine: "api",
        provider: "speech",
        model: "whisper-test",
        language: "uk",
      },
      catalog: { autoRefresh: false },
    }),
  );
  const app = await createAppService(cwd);
  cleanups.push(() => app.dispose());
  return { app, handlers: createHandlers(app, () => undefined) };
}

function recording() {
  return {
    type: "voice.transcribe",
    id: crypto.randomUUID(),
    mimeType: "audio/webm;codecs=opus",
    audio: Buffer.from("recorded-audio").toString("base64"),
  };
}

describe("voice through the app and sidecar handlers", () => {
  test("sends multipart audio with saved credentials, model and language, returns plain text", async () => {
    let calls = 0;
    const { handlers, app } = await appFor(async (request) => {
      calls++;
      expect(new URL(request.url).pathname).toBe("/v1/audio/transcriptions");
      expect(request.headers.get("authorization")).toBe("Bearer test-voice-secret");
      expect(request.headers.get("X-Speech-Test")).toBe("yes");
      const form = await request.formData();
      expect(form.get("model")).toBe("whisper-test");
      expect(form.get("language")).toBe("uk");
      expect(form.get("response_format")).toBe("json");
      const file = form.get("file") as File;
      expect(file.name).toBe("voice.webm");
      expect(await file.text()).toBe("recorded-audio");
      return Response.json({ text: "Привіт, світ." });
    });
    expect(await handlers["voice.status"]({ type: "voice.status" })).toEqual({
      voice: {
        engine: "api",
        providerId: "speech",
        provider: "speech",
        model: "whisper-test",
        language: "uk",
      },
    });
    const destination = await app.voice.status();
    const next = app.settings().config;
    await app.saveSettings({
      config: {
        ...next,
        voice: { provider: "speech", model: "changed-after-recording", language: "en" },
      },
    });
    expect(await handlers["voice.transcribe"]({ ...recording(), destination })).toEqual({
      text: "Привіт, світ.",
    });
    expect(calls).toBe(1);
    expect((await app.listSessions()).length).toBe(0);
    expect(JSON.stringify(app.settings())).not.toContain("test-voice-secret");
  });

  test("validates commands before upload and validates the provider response", async () => {
    let calls = 0;
    const { handlers } = await appFor(() => {
      calls++;
      return Response.json({ text: 42 });
    });
    for (const invalid of [{ audio: "%%%" }, { mimeType: "text/plain" }, { id: "../../secret" }]) {
      await expect(handlers["voice.transcribe"]({ ...recording(), ...invalid })).rejects.toThrow();
    }
    expect(calls).toBe(0);
    await expect(handlers["voice.transcribe"](recording())).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("cancels an in-flight upload and accepts another recording afterward", async () => {
    let arrived!: () => void;
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const { handlers } = await appFor(async () => {
      arrived();
      await Bun.sleep(150);
      return Response.json({ text: "late transcript" });
    });
    const input = recording();
    const result = Promise.resolve(handlers["voice.transcribe"](input)).then(
      () => "resolved",
      () => "cancelled",
    );
    await started;
    await handlers["voice.cancel"]({ type: "voice.cancel", id: input.id });
    expect(await result).toBe("cancelled");
    expect(await handlers["voice.transcribe"](recording())).toEqual({ text: "late transcript" });
  });
});

test("local engines validate setup, keep audio off the provider and cancel the worker", async () => {
  if (process.platform === "win32") return; // Executable fixture uses a POSIX shebang.
  const { chmod, mkdir, readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "liquid-local-voice-"));
  const previous = process.env.FLECTEN_VOICE_HOME;
  process.env.FLECTEN_VOICE_HOME = home;
  cleanups.push(async () => {
    if (previous === undefined) delete process.env.FLECTEN_VOICE_HOME;
    else process.env.FLECTEN_VOICE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  let cloudCalls = 0;
  const { app, handlers } = await appFor(() => {
    cloudCalls++;
    return Response.json({ text: "cloud" });
  });
  const config = app.settings().config;
  config.voice = {
    engine: "vosk",
    provider: "speech",
    model: "whisper-1",
    language: "ru",
    local: {
      python: "python3",
      whisperModel: "small",
      voskModel: "vosk-model-small-ru-0.22",
      device: "cpu",
    },
  };
  await app.saveSettings({ config });
  const options = { id: crypto.randomUUID(), engine: "vosk", local: config.voice.local };
  expect(await handlers["voice.check"]({ type: "voice.check", ...options })).toMatchObject({
    voiceSetup: { ready: false },
  });
  await expect(handlers["voice.status"]({ type: "voice.status" })).rejects.toThrow("не установлен");
  await expect(
    handlers["voice.prepare"]({ type: "voice.prepare", ...options, engine: "other" }),
  ).rejects.toThrow();

  const runtime = join(home, "runtimes/vosk/bin/python");
  await mkdir(join(home, "runtimes/vosk/bin"), { recursive: true });
  await Bun.write(
    runtime,
    `#!${process.execPath}\nimport ${JSON.stringify(resolve("tests/fixtures/voice-runtime.ts"))};\n`,
  );
  await chmod(runtime, 0o755);
  expect(await handlers["voice.status"]({ type: "voice.status" })).toMatchObject({
    voice: { engine: "vosk", model: "vosk-model-small-ru-0.22" },
  });
  await expect(handlers["voice.transcribe"](recording())).rejects.toThrow("WAV");
  const local = {
    ...recording(),
    mimeType: "audio/wav",
    audio: Buffer.from([1, 2, 3]).toString("base64"),
  };
  expect(await handlers["voice.transcribe"](local)).toEqual({ text: "Локальная диктовка." });
  const captured = JSON.parse(await readFile(join(home, "started.json"), "utf8"));
  expect(captured.audio).toEqual([1, 2, 3]);
  expect(captured.args).toContain("vosk-model-small-ru-0.22");
  expect(captured.args).toContain("--language");
  await rm(join(home, "started.json"));
  const input = { ...local, id: crypto.randomUUID(), audio: "AAAA" };
  const result = Promise.resolve(handlers["voice.transcribe"](input)).then(
    () => "resolved",
    () => "cancelled",
  );
  let worker: { pid: number } | undefined;
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      worker = JSON.parse(await readFile(join(home, "started.json"), "utf8"));
      break;
    } catch {
      await Bun.sleep(5);
    }
  }
  expect(worker).toBeDefined();
  await handlers["voice.cancel"]({ type: "voice.cancel", id: input.id });
  expect(await result).toBe("cancelled");
  if (!worker) throw new Error("Local worker did not start");
  const pid = worker.pid;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(await handlers["voice.transcribe"]({ ...local, id: crypto.randomUUID() })).toEqual({
    text: "Локальная диктовка.",
  });
  expect(cloudCalls).toBe(0);
  expect((await app.listSessions()).length).toBe(0);
});
