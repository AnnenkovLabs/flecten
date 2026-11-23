import { createInterface } from "node:readline";
import { productEnv } from "../../shared/environment.cjs";
import { ProjectLockedError } from "../errors";
import { runModuleHost } from "../modules/host";
import { DiagnosticsRuntime } from "../observability/runtime";
import { isObject } from "../util/json";
import { redact } from "../util/redact";
import { lockProject } from "./project-lock";
import { type CommandInput, createHandlers, isCommandType, REFRESH_AFTER } from "./server-handlers";
import { createAppService } from "./service";
import { STORAGE_COMMANDS, StorageBootstrap } from "./storage-bootstrap";

function write(message: unknown): void {
  const safe =
    isObject(message) && message.type === "error" && typeof message.message === "string"
      ? { ...message, message: redact(message.message) }
      : message;
  process.stdout.write(`${JSON.stringify(safe)}\n`);
}

function requestIdOf(command: Record<string, unknown>): string | undefined {
  return typeof command.requestId === "string" ? command.requestId : undefined;
}

function respond(requestId: string | undefined, data: unknown): void {
  if (!requestId) {
    write(data);
    return;
  }
  write({
    type: "response",
    requestId,
    ...(isObject(data) ? data : { data }),
  });
}

function respondError(requestId: string | undefined, message: string): void {
  write({
    type: "response",
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: redact(message),
  });
}

function fail(requestId: string | undefined) {
  return (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (requestId) respondError(requestId, message);
    else write({ type: "error", code: "invalid_input", message });
  };
}

async function main(): Promise<void> {
  const cwd = productEnv("CWD")?.trim() || process.cwd();
  const migration = new StorageBootstrap(cwd, write);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const initialized = migration.initialize();
  let releaseRuntime!: () => void;
  const runtimeReady = new Promise<void>((resolve) => {
    releaseRuntime = resolve;
  });
  let dispatch = async (input: CommandInput): Promise<void> => {
    await initialized;
    if (!migration.blocked) {
      await runtimeReady;
      return dispatch(input);
    }
    respond(requestIdOf(input), { ok: true, ...(await migration.command(input.type)) });
  };
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let command: unknown;
    try {
      command = JSON.parse(line);
    } catch {
      write({ type: "error", code: "invalid_input", message: "command is not valid JSON" });
      return;
    }
    if (!isObject(command) || typeof command.type !== "string" || !isCommandType(command.type)) {
      write({ type: "error", code: "invalid_input", message: "command needs a valid type" });
      return;
    }
    void dispatch(command as CommandInput).catch(fail(requestIdOf(command)));
  });
  const closeBootstrap = () => process.exit(0);
  lines.once("close", closeBootstrap);
  process.once("SIGTERM", closeBootstrap);
  process.once("SIGINT", closeBootstrap);
  await initialized;
  await migration.ready;
  // One core per project: a second window or app on the same folder waits, then gets project_locked.
  const lock = await lockProject(cwd);
  process.once("exit", () => lock.release());
  const app = await createAppService(cwd, productEnv("PROJECTLESS") === "1" ? null : cwd, () => {
    void ready().catch(fail(undefined));
  });
  const diagnostics = new DiagnosticsRuntime(cwd);
  app.session.subscribe((event) => diagnostics.record(event));
  process.on("uncaughtExceptionMonitor", (error) => {
    void diagnostics.crash(error);
  });

  const status = async (): Promise<Record<string, unknown>> => {
    const session = (await app.session.send({ type: "status" })) as Record<string, unknown>;
    const { sessionId: _sessionId, ...runtime } = session;
    return { ...runtime, type: "status", ...app.info(), sessions: app.session.activity() };
  };

  const ready = async (): Promise<void> => write(await status());
  app.session.subscribeStamped((event) => write(event));
  app.ideTerminal.subscribe((event) => write({ type: "terminal.event", event }));
  const handlers = createHandlers(
    app,
    (message, context) => write({ type: "error", code: "run_failed", message, ...context }),
    diagnostics,
  );
  dispatch = async (input) => {
    const requestId = requestIdOf(input);
    if ((STORAGE_COMMANDS as readonly string[]).includes(input.type)) {
      respond(requestId, { ok: true, ...(await migration.command(input.type)) });
      return;
    }
    if (!isCommandType(input.type)) {
      write({ type: "error", code: "invalid_input", message: `unknown command: ${input.type}` });
      return;
    }
    const handler = handlers[input.type as keyof typeof handlers];
    await Promise.resolve()
      .then(() => handler(input))
      .then(async (reply) => {
        if (reply !== undefined) respond(requestId, { ok: true, ...reply });
        if (REFRESH_AFTER.has(input.type)) await ready();
      })
      .catch(fail(requestId));
  };

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    lines.close();
    await app.dispose().catch(() => undefined);
    await diagnostics.flush();
    process.exit(0);
  };
  lines.removeListener("close", closeBootstrap);
  process.removeListener("SIGTERM", closeBootstrap);
  process.removeListener("SIGINT", closeBootstrap);
  lines.on("close", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  releaseRuntime();
  await ready();
  void app
    .resumeInterrupted()
    .then((result) => {
      if (result.interrupted.length > 0) write({ type: "sessions.interrupted", ...result });
    })
    .catch(() => undefined);
}

const moduleEntry = process.argv[2] === "--module-host" ? process.argv[3] : undefined;
(moduleEntry ? runModuleHost(moduleEntry) : main()).catch((error: unknown) => {
  if (moduleEntry) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
    return;
  }
  write({
    type: "error",
    code: error instanceof ProjectLockedError ? "project_locked" : "startup_failed",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
  process.stdin.destroy();
});
