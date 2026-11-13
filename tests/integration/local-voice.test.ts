import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";

// Opt in with a prepared cache and public WAV. Ordinary tests never download models.
test.skipIf(!process.env.FLECTEN_VOICE_SMOKE_AUDIO || !process.env.FLECTEN_VOICE_HOME)(
  "installed Vosk and faster-whisper transcribe real audio through the app",
  async () => {
    const audio = Buffer.from(
      await Bun.file(process.env.FLECTEN_VOICE_SMOKE_AUDIO ?? "").arrayBuffer(),
    ).toString("base64");
    for (const engine of ["vosk", "faster-whisper"] as const) {
      const cwd = await mkdtemp(join(tmpdir(), "liquid-local-speech-"));
      await Bun.write(
        join(cwd, "flecten.config.json"),
        JSON.stringify({
          useDefaults: false,
          provider: "offline",
          model: "unused",
          providers: { offline: { protocol: "openai-chat", baseUrl: "http://127.0.0.1:1/v1" } },
          catalog: { autoRefresh: false },
          voice: {
            engine,
            language: "en",
            local: { whisperModel: "tiny", voskModel: "vosk-model-small-en-us-0.15" },
          },
        }),
      );
      const app = await createAppService(cwd);
      try {
        const handlers = createHandlers(app, () => undefined);
        const status = await handlers["voice.status"]({ type: "voice.status" });
        expect(status).toMatchObject({ voice: { engine } });
        const result = await handlers["voice.transcribe"]({
          type: "voice.transcribe",
          id: crypto.randomUUID(),
          mimeType: "audio/wav",
          audio,
        });
        expect(result).toHaveProperty("text");
        expect((result as { text: string }).text.length).toBeGreaterThan(5);
        expect((await app.listSessions()).length).toBe(0);
      } finally {
        await app.dispose();
        await rm(cwd, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
