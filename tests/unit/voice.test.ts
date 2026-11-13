import { describe, expect, it } from "bun:test";
import { insertTranscript } from "../../ui/src/lib/voice";

describe("insertTranscript", () => {
  it("inserts at the caret and preserves both sides", () => {
    expect(insertTranscript("Привет", 6, "как дела")).toEqual({
      text: "Привет как дела",
      caret: 15,
    });
    expect(insertTranscript("Привет, мир", 6, "как дела")).toEqual({
      text: "Привет как дела, мир",
      caret: 15,
    });
    expect(insertTranscript("", 0, " привет ")).toEqual({
      text: "привет",
      caret: 6,
    });
  });

  it("adds one space only where words meet", () => {
    expect(insertTranscript("abc", 1, "XY")).toEqual({ text: "a XY bc", caret: 4 });
    expect(insertTranscript("abc ", 4, "XY")).toEqual({ text: "abc XY", caret: 6 });
    expect(insertTranscript(" abc", 0, "XY")).toEqual({ text: "XY abc", caret: 2 });
    expect(insertTranscript("(", 1, "привет")).toEqual({ text: "(привет", caret: 7 });
  });

  it("clamps the caret and ignores an empty transcript", () => {
    expect(insertTranscript("abc", 99, "Z")).toEqual({ text: "abc Z", caret: 5 });
    expect(insertTranscript("abc", -5, "Z")).toEqual({ text: "Z abc", caret: 1 });
    expect(insertTranscript("abc", 1, "   ")).toEqual({ text: "abc", caret: 1 });
  });
});

describe("local recording PCM encoding", () => {
  it("writes a mono 16 kHz PCM16 WAV and clamps samples", async () => {
    const { pcmWave } = await import("../../ui/src/lib/composer/voice-wav");
    const blob = pcmWave(new Float32Array([-2, -1, 0, 0.5, 1, 2]));
    const bytes = await blob.arrayBuffer();
    const header = new DataView(bytes);
    expect(blob.type).toBe("audio/wav");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(header.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(header.getUint16(20, true)).toBe(1);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(16000);
    expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_, i) => header.getInt16(44 + i * 2, true))).toEqual([
      -32768, -32768, 0, 16384, 32767, 32767,
    ]);
  });
});

it("preserves legacy API settings and fills local options for a minimal saved config", async () => {
  const { VoiceConfigSchema } = await import("../../src/config/voice");
  const legacy = VoiceConfigSchema.parse({
    provider: "speech",
    model: "whisper-1",
    language: "uk",
  });
  expect(legacy.engine ?? "api").toBe("api");
  expect(legacy.provider).toBe("speech");
  const local = VoiceConfigSchema.parse({ engine: "vosk" });
  expect(local.local).toEqual({
    python: "python3",
    whisperModel: "small",
    voskModel: "vosk-model-small-ru-0.22",
    device: "cpu",
  });
});
