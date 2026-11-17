import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withEnvelope } from "../../src/store/events/envelope";
import { listSessions } from "../../src/store/events/index";
import { manifest } from "../../src/store/storage-migration/fs";
import {
  acceptStorageMigration,
  inspectStorageMigration,
  migrateStorageRoots,
} from "../../src/store/storage-migration/index";
import { paths } from "../../src/store/storage-migration/state";

const directories: string[] = [];
const engine = resolve("src/store/storage-migration/index.ts");
const noProgress = () => {};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function root() {
  const directory = await mkdtemp(join(tmpdir(), "flecten-storage-migration-"));
  directories.push(directory);
  return directory;
}
async function file(root: string, path: string, content: string | Buffer) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
function journal(sessionId: string, prompt = "Original user message") {
  return `${[
    withEnvelope(
      { type: "session.started", sessionId, provider: "test", model: "test", prompt },
      1,
    ),
    withEnvelope(
      {
        type: "message.finished",
        sessionId,
        text: "Original answer",
        reasoning: "",
        toolCalls: [],
      },
      2,
    ),
  ]
    .map((entry) => JSON.stringify({ ...entry, ts: "2026-11-16T00:00:00.000Z" }))
    .join("\n")}\n`;
}
async function child(script: string) {
  const childProcess = Bun.spawn([process.execPath, "--eval", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
  ]);
  return { code, stdout, stderr };
}
async function assertReady(directory: string, ids: string[]) {
  const p = paths(directory);
  expect(await realpath(p.legacy)).toBe(await realpath(p.current));
  expect(await Bun.file(p.accepted).exists()).toBe(false);
  expect(await inspectStorageMigration([directory])).toEqual({ required: true });
  await acceptStorageMigration([directory]);
  expect((await listSessions(directory)).map(({ id }) => id).sort()).toEqual(ids.sort());
  expect(await inspectStorageMigration([directory])).toEqual({ required: false });
}

test("fresh roots initialize durably without asking existing users to skip migration", async () => {
  const directory = await root();
  expect(await inspectStorageMigration([directory, directory])).toEqual({ required: false });
  expect(await realpath(paths(directory).legacy)).toBe(await realpath(paths(directory).current));
  expect(await Bun.file(paths(directory).accepted).exists()).toBe(true);
});

test.each(["legacy", "current", "aliased"])(
  "%s storage requires migration and separate acceptance",
  async (initial) => {
    const directory = await root();
    const p = paths(directory);
    const source = initial === "legacy" ? p.legacy : p.current;
    const transcript = journal("chat");
    await file(source, "sessions/chat/events.jsonl", transcript);
    await file(source, "checkpoints/objects/example", Buffer.from([0, 1, 255]));
    if (initial === "aliased")
      await symlink(process.platform === "win32" ? p.current : ".flecten", p.legacy, "junction");
    const original = await manifest(source);
    expect(await inspectStorageMigration([directory])).toEqual({ required: true });
    await expect(acceptStorageMigration([directory])).rejects.toThrow("must finish");
    const steps: string[] = [];
    await migrateStorageRoots([directory], (step) => {
      steps.push(step);
    });
    expect(steps).toContain("backup");
    expect(steps).toContain("verify");
    const backedUp = join(p.originals, initial === "legacy" ? "legacy" : "current");
    expect(await manifest(backedUp)).toEqual(original);
    expect(await readFile(join(p.current, "sessions/chat/events.jsonl"), "utf8")).toBe(transcript);
    await assertReady(directory, ["chat"]);
  },
);

test("independent stores preserve chats, checkpoints and retired caches without merging derived indexes", async () => {
  const directory = await root();
  const p = paths(directory);
  for (const [store, id] of [
    [p.current, "first"],
    [p.legacy, "second"],
  ] as const) {
    await file(store, `sessions/${id}/events.jsonl`, journal(id));
    await file(store, `checkpoints/objects/${id}`, id);
    await file(store, "cache/models.json", id);
    await file(store, "diagnostics/events.jsonl", id);
    await file(store, "shadow/index", id);
    await file(store, "shared.bin", Buffer.from([0, 255]));
    await file(store, "sessions/index.json", JSON.stringify({ version: 2, sessions: [] }));
  }
  const outside = await root();
  await file(outside, "never-copied", "outside data");
  if (process.platform !== "win32") await symlink(outside, join(p.current, "external-link"));
  const originalCurrent = await manifest(p.current, "durable");
  const originalLegacy = await manifest(p.legacy, "durable");
  await migrateStorageRoots([directory], noProgress);
  expect(await manifest(join(p.originals, "current"))).toEqual(originalCurrent);
  expect(await manifest(join(p.originals, "legacy"))).toEqual(originalLegacy);
  expect(await Bun.file(join(p.current, "shadow/index")).exists()).toBe(false);
  expect(await readFile(join(p.transaction, "retired-legacy/cache/models.json"), "utf8")).toBe(
    "second",
  );
  expect(await readFile(join(p.current, "checkpoints/objects/second"), "utf8")).toBe("second");
  if (process.platform !== "win32")
    expect(await readlink(join(p.current, "external-link"))).toBe(outside);
  await assertReady(directory, ["first", "second"]);
});

test("a complete journal prefix chooses the original longer journal byte for byte", async () => {
  const directory = await root();
  const p = paths(directory);
  const transcript = journal("same");
  const first = transcript.slice(0, transcript.indexOf("\n") + 1);
  await file(p.current, "sessions/same/events.jsonl", first);
  await file(p.legacy, "sessions/same/events.jsonl", transcript);
  await migrateStorageRoots([directory], noProgress);
  expect(await readFile(join(p.current, "sessions/same/events.jsonl"), "utf8")).toBe(transcript);
  expect(await readFile(join(p.originals, "current/sessions/same/events.jsonl"), "utf8")).toBe(
    first,
  );
  await assertReady(directory, ["same"]);
});

test.each(["memory.json", "sessions/same/events.jsonl", "checkpoints/manifests/same.json"])(
  "substantive divergence at %s reports backup locations without publishing",
  async (relative) => {
    const directory = await root();
    const p = paths(directory);
    const left = relative.endsWith("events.jsonl") ? journal("same", "first") : "first";
    const right = relative.endsWith("events.jsonl") ? journal("same", "second") : "second";
    await file(p.current, relative, left);
    await file(p.legacy, relative, right);
    await expect(migrateStorageRoots([directory], noProgress)).rejects.toThrow(p.originals);
    expect(await readFile(join(p.current, relative), "utf8")).toBe(left);
    expect(await readFile(join(p.legacy, relative), "utf8")).toBe(right);
    expect(await readFile(join(p.originals, "current", relative), "utf8")).toBe(left);
    expect(await readFile(join(p.originals, "legacy", relative), "utf8")).toBe(right);
    expect(await Bun.file(p.accepted).exists()).toBe(false);
    await expect(migrateStorageRoots([directory], noProgress)).rejects.toThrow("Storage conflict");
  },
);

test.each([
  "planned",
  "backed-up",
  "merged",
  "verified",
  "retiring",
  "retired",
  "published",
  "ready",
])("SIGKILL after durable %s resumes with both original histories", async (phase) => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "sessions/first/events.jsonl", journal("first"));
  await file(p.legacy, "sessions/second/events.jsonl", journal("second"));
  const result = await child(`
    import { readFileSync } from "node:fs";
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(directory)}], () => {
      const state = JSON.parse(readFileSync(${JSON.stringify(p.state)}, "utf8"));
      if (state.phase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
    });
    process.exit(99);
  `);
  expect(result.code).not.toBe(99);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toBe("");
  expect(await inspectStorageMigration([directory])).toEqual({ required: true });
  await migrateStorageRoots([directory], noProgress);
  expect(await readFile(join(p.originals, "current/sessions/first/events.jsonl"), "utf8")).toBe(
    journal("first"),
  );
  expect(await readFile(join(p.originals, "legacy/sessions/second/events.jsonl"), "utf8")).toBe(
    journal("second"),
  );
  await assertReady(directory, ["first", "second"]);
});

test.each(["retire", "publish"])(
  "SIGKILL between %s rename and its state write remains recoverable",
  async (point) => {
    const directory = await root();
    const p = paths(directory);
    await file(p.current, "sessions/chat/events.jsonl", journal("chat"));
    const target = point === "retire" ? join(p.transaction, "retired-current") : p.current;
    const result = await child(`
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, rename: async (source, target) => {
      await actual.rename(source, target);
      if (target === ${JSON.stringify(target)}) process.kill(process.pid, "SIGKILL");
    } }));
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(directory)}], () => {});
    process.exit(99);
  `);
    expect(result.code).not.toBe(99);
    expect(result.stderr).toBe("");
    await migrateStorageRoots([directory], noProgress);
    await assertReady(directory, ["chat"]);
  },
);

test.each(["ENOSPC", "EACCES"])(
  "%s during real backup/publication preserves originals and resumes",
  async (fault) => {
    const directory = await root();
    const p = paths(directory);
    const transcript = journal("chat");
    await file(p.current, "sessions/chat/events.jsonl", transcript);
    const result = await child(`
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    const fault = ${JSON.stringify(fault)};
    mock.module("node:fs/promises", () => ({ ...actual,
      open: async (path, flags, ...rest) => {
        const handle = await actual.open(path, flags, ...rest);
        if (fault === "ENOSPC" && String(path).includes("/originals/") && typeof flags === "string" && flags.startsWith("wx")) {
          handle.sync = async () => { throw Object.assign(new Error("disk full"), { code: fault }); };
        }
        return handle;
      },
      rename: async (source, target) => {
        if (fault === "EACCES" && source === ${JSON.stringify(p.current)}) throw Object.assign(new Error("permission denied"), { code: fault });
        return actual.rename(source, target);
      },
    }));
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    try { await migrateStorageRoots([${JSON.stringify(directory)}], () => {}); process.exit(99); }
    catch (error) { process.stdout.write(error.code || error.message); }
  `);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(fault);
    expect(await readFile(join(p.current, "sessions/chat/events.jsonl"), "utf8")).toBe(transcript);
    expect(await Bun.file(p.accepted).exists()).toBe(false);
    await migrateStorageRoots([directory], noProgress);
    await assertReady(directory, ["chat"]);
  },
);

test("root aliases never follow an unrelated target", async () => {
  const directory = await root();
  const outside = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "canonical");
  await file(outside, "memory.json", "outside");
  await symlink(outside, p.legacy, process.platform === "win32" ? "junction" : "dir");
  expect(await inspectStorageMigration([directory])).toEqual({ required: true });
  await expect(migrateStorageRoots([directory], noProgress)).rejects.toThrow("Unsafe legacy alias");
  expect(await readFile(join(outside, "memory.json"), "utf8")).toBe("outside");
});

test("a live old core cannot race migration and its original data remains available", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.legacy, "sessions/chat/events.jsonl", journal("chat"));
  await file(
    p.legacy,
    "sidecar.lock",
    JSON.stringify({ pid: process.pid, token: "live", startedAt: new Date().toISOString() }),
  );
  await expect(migrateStorageRoots([directory], noProgress)).rejects.toThrow("still using");
  expect(await readFile(join(p.legacy, "sessions/chat/events.jsonl"), "utf8")).toBe(
    journal("chat"),
  );
  expect(await Bun.file(p.state).exists()).toBe(false);
  await rm(join(p.legacy, "sidecar.lock"));
  await migrateStorageRoots([directory], noProgress);
  await assertReady(directory, ["chat"]);
});
