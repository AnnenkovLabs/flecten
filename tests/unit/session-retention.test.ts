import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintainSessionHistory } from "../../src/app/session-history";
import { SessionsConfigSchema } from "../../src/config/schema-sections";
import { listSessions, recordSessionEvent, sessionIndexPath } from "../../src/store/events/index";
import { saveQueue } from "../../src/store/queue";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("retention archives only inactive completed tasks and expires old trash", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-retention-"));
  dirs.push(cwd);
  for (const id of ["s_old", "s_recent", "s_running", "s_queue", "s_busy"]) {
    await mkdir(join(cwd, ".liquid", "sessions", id), { recursive: true });
    await recordSessionEvent(cwd, {
      type: "session.started",
      sessionId: id,
      prompt: id,
      provider: "p",
      model: "m",
    });
    if (id !== "s_running")
      await recordSessionEvent(cwd, {
        type: "session.finished",
        sessionId: id,
        result: {
          sessionId: id,
          pass: true,
          stopReason: "end",
          summary: "",
          turns: 1,
          usage: { input: 0, output: 0, cached: 0 },
        },
      });
  }
  const indexPath = sessionIndexPath(cwd);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  for (const session of index.sessions)
    if (session.id !== "s_recent") session.updatedAt = "2000-01-01T00:00:00.000Z";
  await writeFile(indexPath, JSON.stringify(index));
  await saveQueue(cwd, "s_queue", {
    version: 1,
    items: [{ id: "q_1", text: "queued", createdAt: 1, mode: "queue", state: "pending" }],
  });
  const oldTrash = join(cwd, ".liquid", "trash", "s_expired");
  await mkdir(oldTrash, { recursive: true });
  await utimes(oldTrash, new Date("2000-01-01"), new Date("2000-01-01"));
  const closed: string[] = [];
  await maintainSessionHistory(
    cwd,
    SessionsConfigSchema.unwrap().parse({}),
    (id) => id === "s_busy",
    async (id) => {
      closed.push(id);
    },
  );
  expect(closed).toEqual(["s_old"]);
  expect((await listSessions(cwd)).map((session) => session.id)).not.toContain("s_old");
  await expect(stat(join(cwd, ".liquid", "trash", "s_old"))).resolves.toBeDefined();
  await expect(stat(oldTrash)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
