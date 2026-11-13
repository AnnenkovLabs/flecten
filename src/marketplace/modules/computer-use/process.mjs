import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

export class DesktopError extends Error {
  constructor(code, message, delivery = "not-delivered") {
    super(message);
    this.name = "DesktopError";
    this.code = code;
    this.delivery = delivery;
  }
}

export function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(directory, name);
    try { accessSync(path, constants.X_OK); return path; } catch {}
  }
  return undefined;
}

function descendants(pid) {
  const members = new Set([pid]);
  const processes = [];
  try {
    for (const entry of readdirSync("/proc")) {
      const candidate = Number(entry);
      if (!Number.isSafeInteger(candidate) || candidate <= 0) continue;
      try {
        const value = readFileSync(`/proc/${candidate}/stat`, "utf8");
        const fields = value.slice(value.lastIndexOf(")") + 2).split(" ");
        processes.push({ pid: candidate, parent: Number(fields[1]), session: Number(fields[3]) });
      } catch {}
    }
  } catch {}
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (!members.has(entry.pid) && (members.has(entry.parent) || entry.session === pid)) {
        members.add(entry.pid);
        changed = true;
      }
    }
  }
  return [...members].reverse();
}

/** Every owned process has its own process group; also include descendants that called setsid. */
export function killProcess(child) {
  if (!child?.pid) return;
  for (const pid of descendants(child.pid)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
}

export function startProcess(command, args, { env, input, extraPipe = false } = {}) {
  const child = spawn(command, args, {
    env, detached: true,
    stdio: extraPipe ? ["pipe", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
  // Observe errors even for long-lived desktop daemons; readiness handles their failure.
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  child.closed = new Promise((resolve) => child.once("close", resolve));
  return child;
}

export async function stopProcess(child) {
  killProcess(child);
  if (!child?.closed) return;
  await child.closed;
}

export function firstLine(child, stream, { signal, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let content = "";
    const finish = (error, line) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      stream.off("data", data);
      child.off("error", failed);
      child.off("close", exited);
      if (error) { killProcess(child); reject(error); } else resolve(line);
    };
    const abort = () => finish(new DesktopError("ABORTED", "Desktop startup was cancelled."));
    const failed = () => finish(new DesktopError("PROCESS_FAILED", "A desktop service could not start."));
    const exited = () => finish(new DesktopError("PROCESS_FAILED", "A desktop service exited before it was ready."));
    const data = (chunk) => {
      content += chunk.toString("utf8");
      const end = content.indexOf("\n");
      if (end >= 0) finish(undefined, content.slice(0, end).trim());
      else if (content.length > 4096) finish(new DesktopError("OUTPUT_LIMIT", "Desktop startup output exceeded its limit."));
    };
    const timer = setTimeout(() => finish(new DesktopError("TIMED_OUT", "Desktop startup timed out.")), timeoutMs);
    stream.on("data", data);
    child.once("error", failed);
    child.once("close", exited);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function runProcess(command, args, { env, input, signal, timeoutMs = 8000, maxBytes = 4_194_304, mutating = false } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = startProcess(command, args, { env, input });
    const chunks = [];
    let size = 0;
    let stopped;
    const delivery = mutating ? "uncertain" : "not-delivered";
    const stop = (error) => { stopped ??= error; killProcess(child); };
    const abort = () => stop(new DesktopError("ABORTED", "Desktop operation was cancelled. Observe before trying again.", delivery));
    const timer = setTimeout(() => stop(new DesktopError("TIMED_OUT", "Desktop operation timed out. Observe before trying again.", delivery)), timeoutMs);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) stop(new DesktopError("OUTPUT_LIMIT", "Desktop output exceeded its limit.", delivery));
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => { stopped = new DesktopError("DEPENDENCY_MISSING", "A required desktop program could not be started."); });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (stopped) reject(stopped);
      else if (code !== 0) reject(new DesktopError("PROCESS_FAILED", `Desktop program ${command.split("/").at(-1)} exited with code ${code}.`, delivery));
      else resolve(Buffer.concat(chunks));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export function delay(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DesktopError("ABORTED", "Desktop wait was cancelled.")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
