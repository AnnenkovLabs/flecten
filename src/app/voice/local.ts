import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { productEnv } from "../../../shared/environment.cjs";
import {
  type LocalVoiceEngine,
  type LocalVoiceOptions,
  VoskModelSchema,
  WhisperModelSchema,
} from "../../config/voice";
import { killProcessTree } from "../../terminal/process-tree";
import worker from "./worker.py" with { type: "text" };

const SetupResult = z.object({ ready: z.boolean(), message: z.string().max(8192) });
const Transcript = z.object({ text: z.string().max(200_000) });
const WorkerError = z.object({ error: z.string().max(8192) });
const PACKAGES = { "faster-whisper": "faster-whisper==1.2.1", vosk: "vosk==0.3.45" };

export function localVoiceHome(): string {
  const explicit = productEnv("VOICE_HOME");
  if (explicit) return explicit;
  const cache =
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? homedir())
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : (process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"));
  const preferred = join(cache, "flecten", "voice");
  const legacy = join(cache, "liquid-harness", "voice");
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

function pythonFor(engine: LocalVoiceEngine): string {
  return join(
    localVoiceHome(),
    "runtimes",
    engine,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}

export function localModel(engine: LocalVoiceEngine, options: LocalVoiceOptions): string {
  return engine === "faster-whisper" ? options.whisperModel : options.voskModel;
}

async function bounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  let size = 0;
  for await (const chunk of stream) {
    const remaining = Math.max(0, limit - size);
    result += decoder.decode(chunk.subarray(0, remaining), { stream: true });
    size += chunk.byteLength;
  }
  return result + decoder.decode();
}

async function run(cmd: string[], signal: AbortSignal, audio?: Uint8Array): Promise<string> {
  signal.throwIfAborted();
  let processHandle: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    processHandle = Bun.spawn({
      cmd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
    });
  } catch {
    throw new Error("Python не найден. Укажите установленный Python 3.9+ в настройках голоса.");
  }
  const abort = () => killProcessTree(processHandle.pid, "SIGKILL", false);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const streams = Promise.all([
    bounded(processHandle.stdout, 1_000_000),
    bounded(processHandle.stderr, 8192),
    processHandle.exited,
  ]);
  try {
    if (audio) processHandle.stdin.write(audio);
    await processHandle.stdin.end();
    const [stdout, stderr, code] = await streams;
    signal.throwIfAborted();
    if (code !== 0) {
      let message = stderr.trim();
      try {
        message = WorkerError.parse(JSON.parse(stdout)).error;
      } catch {
        /* pip and venv write plain stderr. */
      }
      throw new Error(message || "Локальный движок завершился с ошибкой.");
    }
    return stdout;
  } catch (error) {
    if (processHandle.exitCode === null) abort();
    await streams.catch(() => undefined);
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function invoke(
  action: "check" | "prepare" | "transcribe",
  engine: LocalVoiceEngine,
  options: LocalVoiceOptions,
  signal: AbortSignal,
  audio?: Uint8Array,
  model = localModel(engine, options),
  language = "auto",
) {
  (engine === "faster-whisper" ? WhisperModelSchema : VoskModelSchema).parse(model);
  const output = await run(
    [
      pythonFor(engine),
      "-u",
      "-c",
      worker,
      action,
      "--engine",
      engine,
      "--model",
      model,
      "--home",
      localVoiceHome(),
      "--device",
      options.device,
      "--language",
      language,
    ],
    signal,
    audio,
  );
  return JSON.parse(output) as unknown;
}

export async function checkLocalVoice(
  engine: LocalVoiceEngine,
  options: LocalVoiceOptions,
  signal: AbortSignal,
) {
  if (!existsSync(pythonFor(engine)))
    return { ready: false, message: "Движок не установлен. Нажмите «Установить движок и модель»." };
  return SetupResult.parse(await invoke("check", engine, options, signal));
}

export async function prepareLocalVoice(
  engine: LocalVoiceEngine,
  options: LocalVoiceOptions,
  signal: AbortSignal,
) {
  const runtime = join(localVoiceHome(), "runtimes", engine);
  await mkdir(join(localVoiceHome(), "runtimes"), { recursive: true });
  if (!existsSync(pythonFor(engine))) {
    try {
      await run([options.python, "-m", "venv", runtime], signal);
    } catch (error) {
      await rm(runtime, { recursive: true, force: true });
      throw error;
    }
  }
  await run(
    [
      pythonFor(engine),
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--prefer-binary",
      PACKAGES[engine],
    ],
    signal,
  );
  return SetupResult.parse(await invoke("prepare", engine, options, signal));
}

export async function transcribeLocalVoice(
  engine: LocalVoiceEngine,
  options: LocalVoiceOptions,
  audio: Uint8Array,
  signal: AbortSignal,
  model: string,
  language: string,
): Promise<string> {
  return Transcript.parse(
    await invoke("transcribe", engine, options, signal, audio, model, language),
  ).text;
}
