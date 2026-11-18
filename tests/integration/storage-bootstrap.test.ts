import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StorageMigrationState } from "../../shared/storage-migration";
import { withEnvelope } from "../../src/store/events/envelope";

// Keep the test alive for the fixture's message deadline on slow Windows runners.
setDefaultTimeout(30_000);

type Message = Record<string, unknown> & {
  migration?: StorageMigrationState;
  sessions?: { id: string }[];
};
const directories: string[] = [];
const children: Bun.Subprocess<"pipe", "pipe", "pipe">[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited;
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function project() {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-bootstrap-"));
  directories.push(cwd);
  await writeFile(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "test",
      model: "test",
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: "http://127.0.0.1:9/v1",
          models: { test: { context: 32768, output: 4096, tools: true } },
        },
      },
      catalog: { autoRefresh: false },
    }),
  );
  return cwd;
}

function core(cwd: string, options: { profile?: string; script?: string } = {}) {
  const args = options.script ? ["--eval", options.script] : [resolve("src/app/server.ts")];
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    env: {
      ...process.env,
      FLECTEN_CWD: cwd,
      FLECTEN_CONFIG: options.profile ? "" : join(cwd, "flecten.config.json"),
      FLECTEN_PROFILE: options.profile ?? "",
      FLECTEN_SECRET_BACKEND: "file",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  void (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        messages.push(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
      }
      for (const wake of listeners) wake();
    }
  })();
  return {
    child,
    messages,
    send(command: Message) {
      child.stdin.write(`${JSON.stringify(command)}\n`);
    },
    next(predicate: (message: Message) => boolean, timeout = 15000): Promise<Message> {
      return new Promise((resolveMessage, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`Missing message: ${JSON.stringify(messages)}`));
        }, timeout);
        function check() {
          const found = messages.find(predicate);
          if (found) {
            clearTimeout(timer);
            listeners.delete(check);
            resolveMessage(found);
          }
        }
        listeners.add(check);
        check();
      });
    },
  };
}

test("existing users are gated before core startup, recover both chats and accept once", async () => {
  const cwd = await project();
  for (const [store, id] of [
    [".liquid", "old"],
    [".flecten", "new"],
  ] as const) {
    const directory = join(cwd, store, "sessions", id);
    await mkdir(directory, { recursive: true });
    const event = withEnvelope(
      {
        type: "session.started",
        sessionId: id,
        provider: "test",
        model: "test",
        prompt: `verbatim ${id}`,
      },
      1,
    );
    await writeFile(join(directory, "events.jsonl"), `${JSON.stringify(event)}\n`);
  }
  const first = core(cwd);
  await first.next((message) => message.migration?.phase === "required");
  expect(first.messages.some((message) => message.type === "status")).toBe(false);
  expect(await Bun.file(join(cwd, ".flecten/sidecar.lock")).exists()).toBe(false);
  first.send({ type: "run", prompt: "must not start", requestId: "blocked" });
  expect(await first.next((message) => message.requestId === "blocked")).toMatchObject({
    ok: false,
  });
  first.send({ type: "storage.accept", requestId: "premature" });
  expect(await first.next((message) => message.requestId === "premature")).toMatchObject({
    ok: false,
  });
  first.send({ type: "storage.migrate", requestId: "start" });
  expect(await first.next((message) => message.requestId === "start")).toMatchObject({ ok: true });
  await first.next((message) => message.migration?.phase === "complete");
  expect(first.messages.some((message) => message.type === "status")).toBe(false);
  first.child.kill("SIGKILL");
  await first.child.exited;

  const resumed = core(cwd);
  await resumed.next((message) => message.migration?.phase === "complete");
  resumed.send({ type: "storage.accept", requestId: "accept" });
  await resumed.next((message) => message.type === "status");
  resumed.send({ type: "sessions.list", requestId: "chats" });
  const response = await resumed.next((message) => message.requestId === "chats");
  expect(response.sessions?.map((session) => session.id).sort()).toEqual(["new", "old"]);
  resumed.child.stdin.end();
  expect(await resumed.child.exited).toBe(0);
  const reopened = core(cwd);
  await reopened.next((message) => message.type === "status");
  expect(reopened.messages.some((message) => message.type === "storage.migration")).toBe(false);
  expect(
    JSON.parse(await readFile(join(cwd, ".flecten-migration/v1/accepted.json"), "utf8")).version,
  ).toBe(1);
});

test("fresh installs open the core without a migration prompt", async () => {
  const cwd = await project();
  const fresh = core(cwd);
  await fresh.next((message) => message.type === "status");
  expect(fresh.messages.some((message) => message.type === "storage.migration")).toBe(false);
});

test("a moved initialized project opens its core after verifying and accepting the new location", async () => {
  const cwd = await project();
  const original = core(cwd);
  await original.next((message) => message.type === "status");
  original.child.stdin.end();
  expect(await original.child.exited).toBe(0);
  await writeFile(join(cwd, ".flecten", "retained.txt"), "latest saved bytes");
  const moved = `${cwd}-moved`;
  directories.push(moved);
  await rename(cwd, moved);
  const relocated = core(moved);
  await relocated.next((message) => message.migration?.phase === "required");
  expect(relocated.messages.some((message) => message.type === "status")).toBe(false);
  relocated.send({ type: "storage.migrate", requestId: "verify-location" });
  await relocated.next((message) => message.migration?.phase === "complete");
  relocated.send({ type: "storage.accept", requestId: "accept-location" });
  await relocated.next((message) => message.type === "status");
  expect(await readFile(join(moved, ".flecten", "retained.txt"), "utf8")).toBe(
    "latest saved bytes",
  );
  relocated.child.stdin.end();
  expect(await relocated.child.exited).toBe(0);
});

async function rememberedProject(profile: string, path: string): Promise<void> {
  await writeFile(
    join(profile, "projects.json"),
    JSON.stringify({
      version: 1,
      selected: null,
      projects: [{ path, name: "Remembered project", trust: "unknown" }],
    }),
  );
}

function unavailableProject(cwd: string, profile: string, path: string, code: string) {
  return core(cwd, {
    profile,
    script: `
      import { mock } from "bun:test";
      const actual = { ...await import("node:fs/promises") };
      const check = (path) => {
        if (String(path) === ${JSON.stringify(path)})
          throw Object.assign(new Error(${JSON.stringify(`Project unavailable: ${code}`)}), { code: ${JSON.stringify(code)} });
      };
      mock.module("node:fs/promises", () => ({ ...actual,
        stat: async (path, ...args) => { check(path); return actual.stat(path, ...args); },
        realpath: async (path, ...args) => { check(path); return actual.realpath(path, ...args); },
      }));
      await import(${JSON.stringify(resolve("src/app/server.ts"))});
    `,
  });
}

test.each(["EACCES", "ENOTDIR"])(
  "remembered %s projects do not prevent the selected core from opening",
  async (code) => {
    const cwd = await project();
    const profile = await project();
    const unavailable = join(await project(), "remembered");
    await rememberedProject(profile, unavailable);
    const index = await readFile(join(profile, "projects.json"), "utf8");
    const selected = unavailableProject(cwd, profile, unavailable, code);
    await selected.next((message) => message.type === "status");
    expect(selected.messages.some((message) => message.type === "storage.migration")).toBe(false);
    expect(await Bun.file(join(cwd, ".flecten-migration/v1/accepted.json")).exists()).toBe(true);
    expect(await Bun.file(join(unavailable, ".flecten-migration/v1/accepted.json")).exists()).toBe(
      false,
    );
    expect(await readFile(join(profile, "projects.json"), "utf8")).toBe(index);
    selected.child.stdin.end();
    expect(await selected.child.exited).toBe(0);
  },
);

test("a selected EACCES project remains blocked before core startup", async () => {
  const cwd = await project();
  const profile = await project();
  await rememberedProject(profile, cwd);
  const selected = unavailableProject(cwd, profile, cwd, "EACCES");
  const failed = await selected.next((message) => message.migration?.phase === "failed");
  expect(failed.migration?.error).toContain("EACCES");
  expect(selected.messages.some((message) => message.type === "status")).toBe(false);
  expect(await Bun.file(join(cwd, ".flecten/sidecar.lock")).exists()).toBe(false);
});

test("unexpected remembered-project IO errors remain visible and block startup", async () => {
  const cwd = await project();
  const profile = await project();
  const unavailable = join(profile, "remembered");
  await rememberedProject(profile, unavailable);
  const selected = unavailableProject(cwd, profile, unavailable, "EIO");
  const failed = await selected.next((message) => message.migration?.phase === "failed");
  expect(failed.migration?.error).toContain("EIO");
  expect(selected.messages.some((message) => message.type === "status")).toBe(false);
  expect(await Bun.file(join(cwd, ".flecten/sidecar.lock")).exists()).toBe(false);
});
