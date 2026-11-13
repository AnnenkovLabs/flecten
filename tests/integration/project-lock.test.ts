import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_WAIT_MS } from "../../src/app/project-lock";

const SERVER = join(import.meta.dir, "..", "..", "src", "app", "server.ts");
const START_MS = 15_000;

type Message = Record<string, unknown>;

interface Core {
  child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  /** The first message of `type`, or null when none came within `timeoutMs`. */
  next(type: string, timeoutMs?: number): Promise<Message | null>;
}

const dirs: string[] = [];
const cores: Core[] = [];

afterEach(async () => {
  for (const core of cores.splice(0)) {
    core.child.kill("SIGKILL");
    await core.child.exited;
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-lock-core-"));
  dirs.push(cwd);
  const config = {
    useDefaults: false,
    provider: "local",
    model: "local-model",
    providers: {
      local: {
        name: "Local",
        protocol: "openai-chat",
        baseUrl: "http://127.0.0.1:9/v1",
        models: { "local-model": { name: "Local", context: 32768, output: 4096, tools: true } },
      },
    },
    catalog: { autoRefresh: false, ttlMs: 43_200_000 },
  };
  await writeFile(join(cwd, "flecten.config.json"), JSON.stringify(config));
  return cwd;
}

function startCore(cwd: string): Core {
  const child = Bun.spawn([process.execPath, SERVER], {
    cwd,
    env: { ...process.env, FLECTEN_CWD: cwd, FLECTEN_CONFIG: join(cwd, "flecten.config.json") },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const seen: Message[] = [];
  const waiters = new Set<() => void>();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim().length > 0) seen.push(JSON.parse(line) as Message);
      }
      for (const wake of waiters) wake();
    }
  })();
  const core: Core = {
    child,
    next(type, timeoutMs = START_MS) {
      return new Promise((resolve) => {
        const check = (): boolean => {
          const found = seen.find((message) => message.type === type);
          if (!found) return false;
          finish(found);
          return true;
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        const finish = (value: Message | null): void => {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(value);
        };
        const wake = (): void => void check();
        if (!check()) waiters.add(wake);
      });
    },
  };
  cores.push(core);
  return core;
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

describe("one core per project", () => {
  test("a second core waits while the first one works and starts once it exits", async () => {
    const cwd = await project();
    const first = startCore(cwd);
    expect(await first.next("status")).not.toBeNull();
    const second = startCore(cwd);
    expect(await second.next("status", 800)).toBeNull();
    first.child.stdin.end();
    expect(await first.child.exited).toBe(0);
    expect(await second.next("status", LOCK_WAIT_MS)).not.toBeNull();
    second.child.stdin.end();
    expect(await second.child.exited).toBe(0);
    expect(await exists(join(cwd, ".liquid", "sidecar.lock"))).toBe(false);
  }, 30_000);

  test("a core that keeps the project turns the next one away with project_locked", async () => {
    const cwd = await project();
    const first = startCore(cwd);
    expect(await first.next("status")).not.toBeNull();
    const second = startCore(cwd);
    const error = await second.next("error", LOCK_WAIT_MS + START_MS);
    expect(error).toMatchObject({ type: "error", code: "project_locked" });
    expect(String(error?.message)).toContain(`pid ${first.child.pid}`);
    expect(await second.child.exited).toBe(1);
    expect(await exists(join(cwd, ".liquid", "sidecar.lock"))).toBe(true);
  }, 40_000);

  test("a killed core leaves its project to the next one at once", async () => {
    const cwd = await project();
    const first = startCore(cwd);
    expect(await first.next("status")).not.toBeNull();
    first.child.kill("SIGKILL");
    await first.child.exited;
    expect(await exists(join(cwd, ".liquid", "sidecar.lock"))).toBe(true);
    const started = Date.now();
    const second = startCore(cwd);
    expect(await second.next("status")).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(LOCK_WAIT_MS);
  }, 30_000);
});
