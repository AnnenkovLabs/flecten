import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import type { AgentEvent } from "../types";
import { insertTranscript, type VoiceState } from "../voice";
import { encodeRecording, VoiceRecorder } from "./voice-recorder";
import { recordingToWav } from "./voice-wav";

export interface VoiceTarget {
  text(): string;
  caret(): number | null;
  apply(text: string, caret: number): void;
}
type Response = Extract<AgentEvent, { type: "response" }>;

/** One dictation belongs to one draft. It never sends a message itself. */
export class VoiceInput {
  state = $state<VoiceState>("idle");
  stream = $state.raw<MediaStream | null>(null);
  elapsed = $state(0);
  provider = $state("");
  readonly supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  #recorder: VoiceRecorder | null = null;
  #id: string | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #caret = 0;
  #destination: Response["voice"] = undefined;
  readonly #target: VoiceTarget;

  constructor(target: VoiceTarget) {
    this.#target = target;
  }

  get active(): boolean {
    return this.state === "requesting" || this.state === "listening" || this.state === "processing";
  }

  get status(): string {
    if (this.state === "requesting") return t("Connecting to microphone…");
    if (this.state === "processing") return t("Transcribing…");
    const seconds = Math.floor(this.elapsed / 1000);
    return t("Recording {0}:{1}", [
      Math.floor(seconds / 60),
      String(seconds % 60).padStart(2, "0"),
    ]);
  }

  async start(): Promise<void> {
    if (!this.supported || this.active) return;
    const id = crypto.randomUUID();
    this.#id = id;
    this.#caret = this.#target.caret() ?? this.#target.text().length;
    this.state = "requesting";
    this.elapsed = 0;
    this.provider = "";
    try {
      const response = await requestAgent<Response>({ type: "voice.status" });
      if (this.#id !== id) return;
      if (!response.voice) throw new Error(t("Couldn't load voice input settings."));
      this.provider = response.voice.provider;
      this.#destination = response.voice;
      const recorder = new VoiceRecorder();
      this.#recorder = recorder;
      const stream = await recorder.start(
        () => void this.stop(),
        (error) => this.#fail(id, error),
      );
      if (this.#id !== id) {
        recorder.cancel();
        return;
      }
      this.stream = stream;
      this.state = "listening";
      const started = performance.now();
      this.#timer = setInterval(() => {
        this.elapsed = performance.now() - started;
      }, 250);
    } catch (error) {
      this.#fail(id, error);
    }
  }

  async stop(): Promise<void> {
    if (this.state !== "listening" || !this.#recorder || !this.#id) return;
    const id = this.#id;
    this.state = "processing";
    clearInterval(this.#timer);
    this.stream = null;
    try {
      let recording = await this.#recorder.stop();
      if (this.#id !== id) return;
      const local =
        this.#destination?.engine === "faster-whisper" || this.#destination?.engine === "vosk";
      if (local) recording = await recordingToWav(recording);
      if (this.#id !== id) return;
      const audio = await encodeRecording(recording);
      if (this.#id !== id) return;
      const response = await requestAgent<Response>(
        {
          type: "voice.transcribe",
          id,
          audio,
          mimeType: recording.type,
          ...(this.#destination ? { destination: this.#destination } : {}),
        },
        local ? 305_000 : 65_000,
      );
      if (this.#id !== id) return;
      if (typeof response.text !== "string")
        throw new Error(t("The service returned invalid text."));
      if (!response.text.trim()) throw new Error(t("Speech wasn't recognized. Try again."));
      const text = this.#target.text();
      const inserted = insertTranscript(text, this.#target.caret() ?? this.#caret, response.text);
      this.#target.apply(inserted.text, inserted.caret);
      this.#id = null;
      this.#destination = undefined;
      this.#recorder = null;
      this.state = "idle";
    } catch (error) {
      this.#fail(id, error);
    }
  }

  cancel(): void {
    const id = this.#id;
    const processing = this.state === "processing";
    this.#id = null;
    this.#destination = undefined;
    this.#recorder?.cancel();
    this.#recorder = null;
    clearInterval(this.#timer);
    this.stream = null;
    this.state = "idle";
    if (id && processing) void requestAgent({ type: "voice.cancel", id }).catch(() => undefined);
  }

  dispose(): void {
    this.cancel();
  }

  #fail(id: string, error: unknown): void {
    if (this.#id !== id) return;
    this.cancel();
    this.state = "error";
    const denied =
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError");
    toast.error(
      denied
        ? t("Microphone access is blocked. Allow it in system settings.")
        : error instanceof Error
          ? error.message
          : t("Couldn't record speech."),
    );
  }
}
