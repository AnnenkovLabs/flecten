import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json";
import { productEnv } from "../../shared/environment.cjs";
import type { HarnessConfig } from "../config/schema";
import type { Event } from "../core/types";
import { atomicWrite } from "../util/atomic";
import { buildCrashReport, buildDiagnosticsBundle, type LogRecord } from "./diagnostics";
import { redactDeep } from "./redact";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const TRANSIENT = new Set(["message.delta", "reasoning.delta", "tool_call.progress"]);

/** Local, bounded operational evidence. Prompts, outputs and credentials never enter metrics. */
export class DiagnosticsRuntime {
  readonly #directory: string;
  readonly #recent: LogRecord[] = [];
  readonly #errors: unknown[] = [];
  readonly #counts = new Map<string, number>();
  readonly #trace = crypto.randomUUID();
  #writes: Promise<void> = Promise.resolve();
  #failure: string | undefined;

  constructor(readonly cwd: string) {
    this.#directory = join(cwd, ".liquid", "diagnostics");
  }

  record(event: Event): void {
    if (TRANSIENT.has(event.type)) return;
    this.#counts.set(event.type, (this.#counts.get(event.type) ?? 0) + 1);
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level: event.type === "error" ? "error" : "info",
      event: event.type,
      traceId: event.sessionId ?? this.#trace,
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.type === "error" ? { errorCode: event.code } : {}),
      data: {},
    };
    if (event.type === "tool.finished") {
      record.data = {
        tool: event.call.name,
        ok: event.result.ok,
        durationMs: event.result.durationMs,
      };
    }
    if (event.type === "session.finished")
      record.data = {
        reason: event.result.stopReason,
        turns: event.result.turns,
        usage: event.result.usage,
      };
    this.#recent.push(record);
    if (this.#recent.length > 50) this.#recent.shift();
    if (event.type === "error")
      this.#errors.push({ name: "RunError", message: event.message, code: event.code });
    if (this.#errors.length > 20) this.#errors.shift();
    this.#enqueue(async () => {
      await mkdir(this.#directory, { recursive: true });
      const path = join(this.#directory, "events.jsonl");
      const size = await stat(path)
        .then((entry) => entry.size)
        .catch(() => 0);
      if (size >= MAX_LOG_BYTES) await rename(path, `${path}.previous`);
      await appendFile(path, `${JSON.stringify(redactDeep(record))}\n`, { mode: 0o600 });
      if (event.type === "error") {
        await atomicWrite(
          join(this.#directory, "recent-errors.jsonl"),
          `${this.#errors.map((error) => JSON.stringify(redactDeep(error))).join("\n")}\n`,
          0o600,
        );
      }
    });
  }

  async crash(error: unknown): Promise<void> {
    const report = buildCrashReport({
      error,
      traceId: this.#trace,
      version: packageJson.version,
      recentLogs: this.#recent,
    });
    this.#enqueue(() =>
      atomicWrite(join(this.#directory, "crash.json"), JSON.stringify(report, null, 2), 0o600),
    );
    await this.flush();
  }

  async bundle(config: HarnessConfig, configPath: string) {
    await this.flush();
    const bundle = buildDiagnosticsBundle({
      version: packageJson.version,
      commit: productEnv("COMMIT") ?? "unknown",
      paths: { workingDirectory: this.cwd, config: configPath, diagnostics: this.#directory },
      providers: Object.entries(config.providers).map(([name, provider]) => ({
        name,
        ...provider,
      })),
      config,
      recentErrors: this.#errors,
    });
    const path = join(this.#directory, `bundle-${crypto.randomUUID()}.json`);
    const report = {
      ...bundle,
      metrics: Object.fromEntries(this.#counts),
      loggingError: this.#failure,
    };
    await atomicWrite(path, `${JSON.stringify(report, null, 2)}\n`, 0o600);
    return { path, report };
  }

  /** The endpoint receives only counters after explicit opt-in, never a diagnostics bundle. */
  async telemetry(config: HarnessConfig): Promise<void> {
    if (!config.telemetry?.enabled || !config.telemetry.endpoint) return;
    const endpoint = new URL(config.telemetry.endpoint);
    if (
      endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
      )
    ) {
      throw new Error("Telemetry requires HTTPS or a local endpoint");
    }
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        version: packageJson.version,
        platform: process.platform,
        metrics: Object.fromEntries(this.#counts),
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`);
  }

  async flush(): Promise<void> {
    await this.#writes;
  }

  #enqueue(task: () => Promise<void>): void {
    this.#writes = this.#writes.then(task).catch((error: unknown) => {
      this.#failure = error instanceof Error ? error.message : String(error);
    });
  }
}
