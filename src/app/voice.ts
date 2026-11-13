import { z } from "zod";
import type { HarnessConfig } from "../config/schema";
import { LocalVoiceOptionsSchema, LocalVoiceRequestSchema } from "../config/voice";
import { resolveApiKey } from "../providers/registry";
import { createProviderFetch } from "../providers/transport";
import {
  checkLocalVoice,
  localModel,
  prepareLocalVoice,
  transcribeLocalVoice,
} from "./voice/local";

const AudioInput = z.object({
  id: z.string().uuid(),
  audio: z
    .string()
    .min(4)
    .max(3_900_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum([
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/wav",
  ]),
  destination: z
    .object({
      providerId: z.string().min(1).max(200),
      engine: z.enum(["api", "faster-whisper", "vosk"]).default("api"),
      model: z.string().trim().min(1).max(200),
      language: z.enum(["auto", "ru", "uk", "en"]),
    })
    .optional(),
});
const Transcript = z.object({ text: z.string().max(200_000) });

/** Audio is transient: never written to the conversation, filesystem or model context. */
export function voiceService(config: () => HarnessConfig) {
  const pending = new Map<string, AbortController>();
  const lifetime = new AbortController();

  function target(providerId?: string) {
    const current = config();
    const id = providerId ?? (current.voice?.provider || current.provider);
    const provider = current.providers[id];
    if (!provider || !["openai-chat", "openai-responses"].includes(provider.protocol)) {
      throw new Error("Выберите провайдера распознавания в Настройки → Общее → Голосовой ввод.");
    }
    return { current, id, provider };
  }

  return {
    async status() {
      const currentConfig = config();
      const engine = currentConfig.voice?.engine ?? "api";
      if (engine !== "api") {
        const options = LocalVoiceOptionsSchema.parse(currentConfig.voice?.local ?? {});
        const ready = await checkLocalVoice(
          engine,
          options,
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(15_000)]),
        );
        if (!ready.ready) throw new Error(ready.message);
        return {
          engine,
          providerId: engine,
          provider: engine === "vosk" ? "Vosk · локально" : "faster-whisper · локально",
          model: localModel(engine, options),
          language: currentConfig.voice?.language ?? "auto",
        };
      }
      const { current, id, provider } = target();
      return {
        engine: "api" as const,
        providerId: id,
        provider: provider.name ?? id,
        model: current.voice?.model ?? "whisper-1",
        language: current.voice?.language ?? "auto",
      };
    },
    async transcribe(input: unknown): Promise<string> {
      const { id: recordingId, audio, mimeType, destination } = AudioInput.parse(input);
      if (pending.size > 0) throw new Error("Дождитесь завершения распознавания.");
      const currentConfig = config();
      const engine = destination?.engine ?? currentConfig.voice?.engine ?? "api";
      const controller = new AbortController();
      pending.set(recordingId, controller);
      try {
        const bytes = Buffer.from(audio, "base64");
        if (
          bytes.length > (engine === "api" ? 2 * 1024 * 1024 : 2_900_044) ||
          bytes.toString("base64") !== audio
        ) {
          throw new Error("Запись слишком большая или повреждена. Запишите до 90 секунд.");
        }
        if (engine !== "api") {
          if (mimeType !== "audio/wav")
            throw new Error("Для локального ввода нужен WAV PCM16, 16000 Гц.");
          const options = LocalVoiceOptionsSchema.parse(currentConfig.voice?.local ?? {});
          return await transcribeLocalVoice(
            engine,
            options,
            bytes,
            AbortSignal.any([controller.signal, lifetime.signal, AbortSignal.timeout(300_000)]),
            destination?.model ?? localModel(engine, options),
            destination?.language ?? currentConfig.voice?.language ?? "auto",
          );
        }
        const { current, id, provider } = target(destination?.providerId);
        const model = destination?.model ?? current.voice?.model ?? "whisper-1";
        const language = destination?.language ?? current.voice?.language ?? "auto";
        const key = resolveApiKey(id, provider);
        const body = new FormData();
        const extension =
          mimeType === "audio/wav"
            ? "wav"
            : mimeType === "audio/mp4"
              ? "mp4"
              : mimeType.startsWith("audio/ogg")
                ? "ogg"
                : "webm";
        body.set("file", new Blob([bytes], { type: mimeType }), `voice.${extension}`);
        body.set("model", model);
        body.set("response_format", "json");
        if (language !== "auto") {
          body.set("language", language);
        }
        const headers = new Headers(provider.headers);
        headers.delete("Content-Type");
        if (key) headers.set("Authorization", `Bearer ${key}`);
        const transport = createProviderFetch({
          headers: Object.fromEntries(headers),
          ...(provider.proxy ? { proxy: provider.proxy } : {}),
          timeoutMs: 60_000,
        });
        const url = new URL(provider.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
          throw new Error("Укажите HTTP или HTTPS адрес провайдера без пароля в URL.");
        }
        if (!url.pathname.endsWith("/")) url.pathname += "/";
        url.pathname += "audio/transcriptions";
        const response = await transport(url, {
          method: "POST",
          body,
          redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        });
        return Transcript.parse(await response.json()).text;
      } finally {
        pending.delete(recordingId);
      }
    },
    async setup(input: unknown, prepare: boolean) {
      const { id, ...options } = LocalVoiceRequestSchema.extend({ id: z.string().uuid() }).parse(
        input,
      );
      if (pending.size > 0)
        throw new Error("Уже выполняется установка или распознавание. Дождитесь завершения.");
      const controller = new AbortController();
      pending.set(id, controller);
      try {
        const signal = AbortSignal.any([
          controller.signal,
          lifetime.signal,
          AbortSignal.timeout(prepare ? 900_000 : 15_000),
        ]);
        return await (prepare ? prepareLocalVoice : checkLocalVoice)(
          options.engine,
          options.local,
          signal,
        );
      } finally {
        pending.delete(id);
      }
    },
    cancel(id: string) {
      pending.get(id)?.abort();
    },
    dispose() {
      lifetime.abort();
      for (const controller of pending.values()) controller.abort();
    },
  };
}
