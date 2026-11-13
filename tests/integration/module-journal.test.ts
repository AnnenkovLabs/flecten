import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { moduleFixture } from "../helpers/modules";
import { installExample, type PlatformFixture } from "../helpers/platform-modules";

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("SQLite example replaces journal writes, list/search/read/rename/fork/delete, replay and interrupted recovery", async () => {
  const f = await moduleFixture();
  fixtures.push(f);
  await f.app.acceptTrust();
  await installExample(f, "sqlite-journal");
  const raw = "  Preserve this request\nword for word.  ";
  await f.app.session.send({ type: "run", sessionId: "ledger", prompt: raw });
  await f.app.session.flush();
  expect(await Bun.file(join(f.cwd, ".liquid/module-journal.sqlite")).exists()).toBe(true);
  expect(await Bun.file(join(f.cwd, ".liquid/sessions/ledger/events.jsonl")).exists()).toBe(false);
  expect(await f.app.listSessions()).toMatchObject([{ id: "ledger", lastPrompt: raw }]);
  expect(await f.app.searchSessions("word for word")).toHaveLength(1);
  expect(await f.app.renameSession("ledger", "A renamed ledger")).toMatchObject({
    title: "A renamed ledger",
  });
  const fork = await f.app.forkSession("ledger", { title: "Ledger fork" });
  expect(fork.title).toBe("Ledger fork");
  expect(
    (await f.app.readSession(fork.id)).find((e) => e.type === "session.started"),
  ).toMatchObject({ sessionId: fork.id, prompt: raw });
  await f.app.deleteSession(fork.id, { confirm: true });
  expect(await f.app.listSessions()).toHaveLength(1);
  await f.app.dispose();
  const reopened = await createAppService(f.cwd);
  try {
    await reopened.acceptTrust();
    expect(await reopened.listSessions()).toMatchObject([
      { id: "ledger", title: "A renamed ledger" },
    ]);
    await reopened.session.send({
      type: "run",
      sessionId: "ledger",
      prompt: "Continue the ledger",
    });
    expect(JSON.stringify(f.requests.at(-1))).toContain("Preserve this request");
    await reopened.session.flush();
    expect(
      (await reopened.readSession("ledger")).filter((e) => e.type === "session.started"),
    ).toHaveLength(2);
    // A crash marker written through the same real repository is recovered from SQLite.
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(f.cwd, ".liquid/module-journal.sqlite"));
    const started = {
      type: "session.started",
      sessionId: "crashed",
      provider: "test",
      model: "test",
      prompt: "Interrupted",
    };
    db.query("INSERT INTO sessions (id) VALUES (?)").run("crashed");
    db.query("INSERT INTO events VALUES (?, ?, ?, ?)").run(
      "crashed",
      1,
      new Date().toISOString(),
      JSON.stringify(started),
    );
    db.close();
    const config = reopened.settings().config;
    config.sessions = { ...config.sessions, autoResume: false } as NonNullable<
      typeof config.sessions
    >;
    await reopened.saveSettings({ config });
    expect(await reopened.resumeInterrupted()).toMatchObject({
      interrupted: ["crashed"],
      resumed: [],
    });
    expect((await reopened.readSession("crashed")).at(-1)).toMatchObject({
      type: "run.interrupted",
      sessionId: "crashed",
    });
  } finally {
    await reopened.dispose();
  }
}, 20_000);
