import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StorageMigrationState } from "../../shared/storage-migration";
import { withEnvelope } from "../../src/store/events/envelope";

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

function core(cwd: string) {
  const child = Bun.spawn([process.execPath, resolve("src/app/server.ts")], {
    cwd,
    env: { ...process.env, FLECTEN_CWD: cwd, FLECTEN_CONFIG: join(cwd, "flecten.config.json") },
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
}, 30000);

test("fresh installs open the core without a migration prompt", async () => {
  const cwd = await project();
  const fresh = core(cwd);
  await fresh.next((message) => message.type === "status");
  expect(fresh.messages.some((message) => message.type === "storage.migration")).toBe(false);
});
