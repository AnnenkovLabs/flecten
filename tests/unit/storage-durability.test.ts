import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type FileHandle, mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionLogs } from "../../src/app/session-logs";
import type { Event } from "../../src/core/types";
import { listSessions } from "../../src/store/events";
import { DurableEventLog, readTolerant } from "../../src/store/events/envelope";
import { sessionPaths } from "../../src/store/paths";
import { restoredQueue, saveQueue } from "../../src/store/queue";
import { atomicWrite } from "../../src/util/atomic";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-durability-"));
  dirs.push(cwd);
  return cwd;
}

async function syncHook(hook: (handle: FileHandle) => Promise<void>) {
  const probe = await open(import.meta.filename, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const original = prototype.sync;
  return spyOn(prototype, "sync").mockImplementation(async function (this: FileHandle) {
    await hook(this);
    await original.call(this);
  });
}

function ioFailure(): Error {
  return Object.assign(new Error("injected disk IO failure"), { code: "EIO" });
}

function started(sessionId: string): Event {
  return { type: "session.started", sessionId, provider: "test", model: "test", prompt: "go" };
}

describe("storage durability acknowledgements", () => {
  test("failed file sync keeps the previous settings whole and removes its temp file", async () => {
    const cwd = await workspace();
    const path = join(cwd, "settings.json");
    await atomicWrite(path, "old", 0o600);
    const hook = await syncHook(async (handle) => {
      if ((await handle.stat()).isFile()) throw ioFailure();
    });
    try {
      await expect(atomicWrite(path, "new", 0o600)).rejects.toThrow("disk IO failure");
    } finally {
      hook.mockRestore();
    }
    expect(await Bun.file(path).text()).toBe("old");
    expect(await readdir(cwd)).toEqual(["settings.json"]);
  });

  test.skipIf(process.platform === "win32")(
    "failed directory sync rejects a replacement even after its new bytes become visible",
    async () => {
      const cwd = await workspace();
      const path = join(cwd, "settings.json");
      await atomicWrite(path, "old");
      const hook = await syncHook(async (handle) => {
        if ((await handle.stat()).isDirectory()) throw ioFailure();
      });
      try {
        await expect(atomicWrite(path, "new")).rejects.toThrow("disk IO failure");
      } finally {
        hook.mockRestore();
      }
      expect(await Bun.file(path).text()).toBe("new");
      expect(await readdir(cwd)).toEqual(["settings.json"]);
    },
  );

  test("the journal reaches durable storage before its session index is published", async () => {
    const cwd = await workspace();
    const logs = new SessionLogs(cwd, () => []);
    const order: string[] = [];
    const hook = await syncHook(async (handle) => {
      const info = await handle.stat();
      if (!info.isFile() || info.size === 0) return;
      const journal = await stat(sessionPaths(cwd, "s_sync_order").events);
      order.push(info.ino === journal.ino && info.dev === journal.dev ? "journal" : "index");
    });
    try {
      await logs.persist(started("s_sync_order"));
      expect(order).toEqual(["journal", "index"]);
    } finally {
      hook.mockRestore();
      await logs.closeAll();
    }
  });

  test("a journal sync failure stays failed through queued writes, flush and close", async () => {
    const cwd = await workspace();
    const path = join(cwd, "events.jsonl");
    const id = "s_sticky_failure";
    const log = await DurableEventLog.open(path, id);
    const hook = await syncHook(async () => {
      throw ioFailure();
    });
    try {
      const writes = await Promise.allSettled([
        log.append(started(id), { fsync: true }),
        log.append({ type: "turn.started", sessionId: id, turn: 1 }, { fsync: true }),
      ]);
      expect(writes.map((write) => write.status)).toEqual(["rejected", "rejected"]);
      await expect(log.flush()).rejects.toThrow("disk IO failure");
      await expect(log.close()).rejects.toThrow("disk IO failure");
      expect(log.lastError?.message).toContain("disk IO failure");
    } finally {
      hook.mockRestore();
      await log.close().catch(() => undefined);
    }
    const reopened = await DurableEventLog.open(path, id);
    await reopened.close();
    expect((await readTolerant(path)).envelopes.map(({ event }) => event.type)).toEqual([
      "session.started",
    ]);
  });

  test("the product rejects failed event persistence and reports it again when closing", async () => {
    const cwd = await workspace();
    const logs = new SessionLogs(cwd, () => []);
    const id = "s_product_failure";
    await logs.persist(started(id));
    const hook = await syncHook(async () => {
      throw ioFailure();
    });
    try {
      await expect(logs.persist({ type: "turn.started", sessionId: id, turn: 1 })).rejects.toThrow(
        "disk IO failure",
      );
    } finally {
      hook.mockRestore();
    }
    await expect(logs.close(id)).rejects.toThrow("disk IO failure");
    await logs.closeAll();
  });

  test.skipIf(process.platform === "win32")(
    "a failed journal open releases its writer guard and reports the directory IO error",
    async () => {
      const cwd = await workspace();
      const path = join(cwd, "events.jsonl");
      const id = "s_failed_open";
      const hook = await syncHook(async (handle) => {
        if ((await handle.stat()).isDirectory()) throw ioFailure();
      });
      try {
        await expect(DurableEventLog.open(path, id)).rejects.toThrow("disk IO failure");
      } finally {
        hook.mockRestore();
      }
      await (await DurableEventLog.open(path, id)).close();
    },
  );

  test.skipIf(process.platform === "win32")(
    "queue removal reports directory sync failure instead of acknowledging it",
    async () => {
      const cwd = await workspace();
      await saveQueue(cwd, "s_sync_queue", {
        version: 1,
        items: [{ id: "q", text: "go", mode: "queue", createdAt: 1, state: "pending" }],
      });
      const hook = await syncHook(async (handle) => {
        if ((await handle.stat()).isDirectory()) throw ioFailure();
      });
      try {
        await expect(saveQueue(cwd, "s_sync_queue", { version: 1, items: [] })).rejects.toThrow(
          "disk IO failure",
        );
      } finally {
        hook.mockRestore();
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "SIGKILL after the production acknowledgement retains both sessions, settings and queue recovery",
    async () => {
      const cwd = await workspace();
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, "../helpers/durable-session-child.ts"), cwd],
        { stdout: "pipe", stderr: "pipe" },
      );
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try {
        const reader = child.stdout.getReader();
        let output = "";
        while (!output.includes("ACK\n")) {
          const next = await reader.read();
          if (next.done) throw new Error(await new Response(child.stderr).text());
          output += new TextDecoder().decode(next.value);
        }
        reader.releaseLock();
        child.kill("SIGKILL");
        await child.exited;
        const sessions = await listSessions(cwd);
        expect(sessions.map(({ id }) => id).sort()).toEqual(["s_crash_first", "s_crash_second"]);
        const { envelopes } = await readTolerant(sessionPaths(cwd, "s_crash_first").events);
        expect(envelopes.map(({ event }) => event.type)).toEqual([
          "session.started",
          "message.finished",
        ]);
        expect(envelopes[1]?.event).toMatchObject({ text: "acknowledged answer" });
        expect((await restoredQueue(cwd, "s_crash_first"))?.items).toMatchObject([
          { id: "pending", state: "pending", text: "next" },
        ]);
        expect(await Bun.file(join(cwd, "settings.json")).json()).toEqual({ theme: "dark" });
      } finally {
        clearTimeout(timeout);
        child.kill("SIGKILL");
        await child.exited;
      }
    },
    10_000,
  );
});
