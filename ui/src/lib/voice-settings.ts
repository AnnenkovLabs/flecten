import { t } from "./i18n.svelte";
export type VoiceEngine = "api" | "faster-whisper" | "vosk";
export type VoiceLanguage = "auto" | "ru" | "uk" | "en";
export interface LocalVoiceOptions {
  python: string;
  whisperModel: "tiny" | "base" | "small" | "medium" | "large-v3" | "large-v3-turbo";
  voskModel:
    | "vosk-model-small-ru-0.22"
    | "vosk-model-small-en-us-0.15"
    | "vosk-model-small-uk-v3-nano";
  device: "cpu" | "cuda";
}
export interface VoiceSettingsConfig {
  engine?: VoiceEngine;
  provider: string;
  model: string;
  language: VoiceLanguage;
  local?: LocalVoiceOptions;
}
export interface VoiceDestination {
  engine?: VoiceEngine;
  providerId: string;
  model: string;
  language: VoiceLanguage;
}
export function localVoiceDefaults(): LocalVoiceOptions {
  return {
    python: "python3",
    whisperModel: "small",
    voskModel: "vosk-model-small-ru-0.22",
    device: "cpu",
  };
}
export const WHISPER_MODELS = [
  {
    value: "tiny",
    get label() {
      return t("Tiny · fast, about 75 MB");
    },
  },
  {
    value: "base",
    get label() {
      return t("Base · about 145 MB");
    },
  },
  {
    value: "small",
    get label() {
      return t("Small · balanced, about 465 MB");
    },
  },
  {
    value: "medium",
    get label() {
      return t("Medium · more accurate, about 1.5 GB");
    },
  },
  {
    value: "large-v3-turbo",
    get label() {
      return t("Large v3 turbo · about 1.6 GB");
    },
  },
  {
    value: "large-v3",
    get label() {
      return t("Large v3 · more accurate, about 3 GB");
    },
  },
] as const;
export const VOSK_MODELS = [
  {
    value: "vosk-model-small-ru-0.22",
    get label() {
      return t("Russian · 45 MB");
    },
  },
  {
    value: "vosk-model-small-en-us-0.15",
    get label() {
      return t("English · 40 MB");
    },
  },
  {
    value: "vosk-model-small-uk-v3-nano",
    get label() {
      return t("Українська · 73 MB");
    },
  },
] as const;
