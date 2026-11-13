import { t } from "../i18n.svelte";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_MS = 90_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** Owns the mic. Closing releases tracks, including late permission grants. */
export class VoiceRecorder {
  #recorder: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #cancelled = false;
  #chunks: Blob[] = [];

  async start(onLimit: () => void, onError: (error: Error) => void): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (this.#cancelled) {
      for (const track of stream.getTracks()) track.stop();
      throw new DOMException("Recording cancelled", "AbortError");
    }
    this.#stream = stream;
    try {
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error(t("This browser doesn't support the recording format."));
      this.#recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      this.#recorder.onerror = () => {
        this.cancel();
        onError(new Error(t("Couldn't record audio. Check your microphone.")));
      };
      this.#chunks = [];
      let bytes = 0;
      this.#recorder.ondataavailable = ({ data }) => {
        if (this.#cancelled) return;
        this.#chunks.push(data);
        bytes += data.size;
        if (bytes >= MAX_BYTES) onLimit();
      };
      stream.getAudioTracks()[0]?.addEventListener("ended", onLimit, { once: true });
      this.#recorder.start(250);
      this.#timer = setTimeout(onLimit, MAX_DURATION_MS);
      return stream;
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.#recorder;
    if (!recorder || recorder.state === "inactive")
      return Promise.reject(new Error(t("No recording.")));
    clearTimeout(this.#timer);
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.#chunks, { type: recorder.mimeType });
        this.#release();
        if (blob.size === 0 || blob.size > MAX_BYTES) {
          reject(
            new Error(t("The recording is empty or larger than 2 MB. Try a shorter recording.")),
          );
        } else resolve(blob);
      };
      recorder.onerror = () => {
        this.cancel();
        reject(new Error(t("Couldn't record audio. Check your microphone.")));
      };
      recorder.stop();
      // Permission indicator goes off immediately; onstop delivers the buffered audio.
      for (const track of this.#stream?.getTracks() ?? []) track.stop();
    });
  }

  cancel(): void {
    this.#cancelled = true;
    const recorder = this.#recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.#release();
  }

  #release(): void {
    clearTimeout(this.#timer);
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = null;
    this.#recorder = null;
    this.#chunks = [];
  }
}

export async function encodeRecording(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(parts.join(""));
}
