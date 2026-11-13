import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { pullRequestParts } from "../../src/app/pull-request-context";
import { inputModalities } from "../../src/app/service-policy";
import { HarnessConfigSchema } from "../../src/config/schema";
import { estimateMessages, PROFILE_4 } from "../../src/context";
import { loadAttachments } from "../../src/core/attachments";
import { flacDuration, mp3Duration } from "../../src/core/audio-duration";
import { ContextReferencesSchema } from "../../src/core/context-reference";
import { contextEstimate } from "../../src/core/loop/context";
import { mediaTokens } from "../../src/core/media";
import { RunQueue } from "../../src/core/queue/queue";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { anthropicMedia, chatMedia, responsesMedia } from "../../src/providers/input-media";
import { ToolRegistry } from "../../src/tools/registry";
import { readPromptClipboard } from "../../ui/src/lib/composer/prompt-clipboard";
import { editorContext } from "../../ui/src/lib/ide/context";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-media-"));
  dirs.push(cwd);
  return cwd;
}
const reference = {
  kind: "selection" as const,
  source: "src/main.ts#L1-L2",
  label: "Selected code",
  text: "let answer = 42;\n</attachment>",
};

describe("structured user context", () => {
  test("the production run sends selected context as source data and keeps the exact user prompt", async () => {
    const cwd = await workspace();
    const provider = scriptedProvider([[{ type: "done", reason: "end" }]]);
    const events: Event[] = [];
    const limits = {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 10_000,
      readLimitLines: 2000,
    };
    const session = createSession({
      cwd,
      provider,
      providerId: "test",
      model: "test",
      tools: new ToolRegistry([], { limits }),
      system: "test",
      limits,
      maxOutputTokens: 100,
      context: { window: 100_000, reserve: 1000 },
      loop: { maxTurns: 1, continuations: 0, parallelTools: false },
      logDir: () => cwd,
    });
    session.subscribe((event) => events.push(event));
    await session.send({ type: "run", prompt: "Keep my  spacing\n", contexts: [reference] });
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "- Source: `src/main.ts#L1-L2`\n- Kind: `selection`",
    );
    expect(provider.requests[0]?.messages[0]?.content).toContain("let answer = 42;\n</attachment>");
    const started = events.find((event) => event.type === "session.started");
    expect(started?.type === "session.started" && started.prompt).toBe("Keep my  spacing\n");
  });

  test("queued references survive restart and cannot mutate the queue through a returned object", () => {
    const queue = new RunQueue();
    const item = queue.add("Inspect @selection", "steer", undefined, "q_context", [reference]);
    if (item.contexts?.[0]) item.contexts[0].text = "changed outside";
    const restored = RunQueue.restore(queue.serialize());
    expect(restored.list()[0]?.contexts).toEqual([reference]);
    expect(
      ContextReferencesSchema.safeParse([{ ...reference, text: "x".repeat(60_001) }]).success,
    ).toBe(false);
  });

  test("selection and symbol come from the editor selection and parsed grammar", () => {
    const doc = "export function calculate() {\n  return 42;\n}\n";
    const state = EditorState.create({
      doc,
      selection: { anchor: 35, head: 41 },
      extensions: [javascript()],
    });
    const context = editorContext("math.ts", state);
    expect(context.selection?.text).toBe(doc.slice(35, 41));
    expect(context.symbol?.text).toBe("function calculate() {\n  return 42;\n}");
  });

  test("typed mentions survive clipboard and GitHub references reject arbitrary endpoints", () => {
    const text = "@selection";
    expect(
      readPromptClipboard(
        JSON.stringify({
          text,
          mentions: [
            {
              start: 0,
              end: text.length,
              path: "selection",
              kind: "selection",
              context: reference,
            },
          ],
        }),
        text,
      )?.mentions[0]?.context,
    ).toEqual(reference);
    expect(pullRequestParts("https://github.com/acme/project/pull/42")).toEqual({
      owner: "acme",
      repository: "project",
      number: 42,
    });
    expect(() => pullRequestParts("https://localhost/acme/project/pull/42")).toThrow();
  });
});

describe("multimodal input", () => {
  test("compressed audio uses frame metadata, including variable bitrate MP3", () => {
    const mp3 = Buffer.alloc(417 + 626);
    mp3.writeUInt32BE(0xfffb9000, 0);
    mp3.writeUInt32BE(0xfffbb000, 417);
    expect(mp3Duration(mp3)).toBeCloseTo(2304 / 44100);
    expect(mp3Duration(Buffer.from("invalid"))).toBeUndefined();
    const flac = Buffer.alloc(42);
    flac.write("fLaC", 0);
    flac.writeUIntBE(34, 5, 3);
    flac.writeBigUInt64BE((16000n << 44n) | 32000n, 18);
    expect(flacDuration(flac)).toBe(2);
  });
  test("WAV input is attached only for an audio model and its duration reserves context", async () => {
    const cwd = await workspace();
    const bytes = Buffer.alloc(44 + 32_000);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16_000, 24);
    bytes.writeUInt32LE(32_000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(32_000, 40);
    await writeFile(join(cwd, "speech.wav"), bytes);
    const plain = await loadAttachments(["speech.wav"], { cwd, modalities: ["text"] });
    expect(plain.parts).toHaveLength(0);
    const audio = await loadAttachments(["speech.wav"], { cwd, modalities: ["text", "audio"] });
    const part = audio.parts[0];
    if (!part) throw new Error("missing audio part");
    expect(part.mediaType).toBe("audio/wav");
    expect(part.estimatedTokens).toBe(32);
    expect(chatMedia(part)).toEqual({
      type: "input_audio",
      input_audio: { data: part.data, format: "wav" },
    });
    expect(() => responsesMedia(part)).toThrow("Responses");
    expect(() => anthropicMedia(part)).toThrow("Anthropic");
  });

  test("audio and PDF switches govern the actual attachment modalities", () => {
    const config = HarnessConfigSchema.parse({
      provider: "p",
      model: "m",
      providers: {
        p: {
          protocol: "openai-chat",
          baseUrl: "https://example.com",
          models: {
            m: { modalities: { input: ["text", "image"] }, vision: false, audio: true, pdf: true },
          },
        },
      },
    });
    expect(inputModalities(config)).toEqual(["text", "pdf", "audio"]);
  });

  test("image and PDF reservations reach the context meter instead of counting every binary as one image", async () => {
    const cwd = await workspace();
    const image = Buffer.alloc(24);
    image.writeUInt32BE(0x89504e47);
    image.writeUInt32BE(2048, 16);
    image.writeUInt32BE(1024, 20);
    await writeFile(join(cwd, "large.png"), image);
    await writeFile(join(cwd, "document.pdf"), "%PDF-1.7\n");
    const loaded = await loadAttachments(["large.png", "document.pdf"], {
      cwd,
      modalities: ["image", "pdf"],
    });
    expect(loaded.parts.map(mediaTokens)).toEqual([1445, 4096]);
    const tools = new ToolRegistry([], {
      limits: {
        maxOutputBytes: 50_000,
        maxOutputLines: 2000,
        bashTimeoutMs: 10_000,
        readLimitLines: 2000,
      },
    });
    const plain = contextEstimate("", [{ role: "user", content: "explain" }], tools);
    expect(
      contextEstimate("", [{ role: "user", content: "explain", images: loaded.parts }], tools) -
        plain,
    ).toBe(5541);
    const baseline = estimateMessages([{ role: "user", content: "explain" }], PROFILE_4).tokens;
    expect(
      estimateMessages([{ role: "user", content: "explain", mediaTokens: 5541 }], PROFILE_4)
        .tokens - baseline,
    ).toBe(5541);
  });
});
