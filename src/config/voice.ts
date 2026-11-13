import { z } from "zod";

export const LocalVoiceEngineSchema = z.enum(["faster-whisper", "vosk"]);
export const VoiceLanguageSchema = z.enum(["auto", "ru", "uk", "en"]);
export const WhisperModelSchema = z.enum([
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
  "large-v3-turbo",
]);
export const VoskModelSchema = z.enum([
  "vosk-model-small-ru-0.22",
  "vosk-model-small-en-us-0.15",
  "vosk-model-small-uk-v3-nano",
]);
export const LocalVoiceOptionsSchema = z.object({
  python: z.string().trim().min(1).max(4096).default("python3"),
  whisperModel: WhisperModelSchema.default("small"),
  voskModel: VoskModelSchema.default("vosk-model-small-ru-0.22"),
  device: z.enum(["cpu", "cuda"]).default("cpu"),
});
export const VoiceConfigSchema = z.object({
  engine: z.enum(["api", "faster-whisper", "vosk"]).optional(),
  provider: z.string().max(200).default(""),
  model: z.string().trim().min(1).max(200).default("whisper-1"),
  language: VoiceLanguageSchema.default("auto"),
  local: LocalVoiceOptionsSchema.default(() => LocalVoiceOptionsSchema.parse({})),
});
export const LocalVoiceRequestSchema = z.object({
  engine: LocalVoiceEngineSchema,
  local: LocalVoiceOptionsSchema,
});
export type LocalVoiceOptions = z.infer<typeof LocalVoiceOptionsSchema>;
export type LocalVoiceEngine = z.infer<typeof LocalVoiceEngineSchema>;
