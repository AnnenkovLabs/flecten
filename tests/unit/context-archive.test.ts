import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextMessage, PROFILE_4 } from "../../src/context";
import { PageWriter } from "../../src/core/pages/writer";
import type { Event } from "../../src/core/types";
import { forkSession, listSessions } from "../../src/store/events/index";
import { readSession } from "../../src/store/events/read";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { appendEvent } from "../helpers/append-event";
import { scriptedProvider } from "../helpers/fake-provider";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "liquid-context-archive-"));
  directories.push(path);
  return path;
}

function provider() {
  return scriptedProvider([
    [
      {
        type: "text",
        delta: JSON.stringify({
          progress: "Completed login and registration",
          locations: "ui/auth.ts",
          instructions: "Keep existing authentication API",
          nextSteps: "Build dashboard shell",
          risks: "none",
        }),
      },
      { type: "done", reason: "end" },
    ],
  ]);
}

test("compacted text omitted from summary remains searchable and readable after restart", async () => {
  const cwd = await workspace();
  const paths = sessionPaths(cwd, "s_archive");
  const sink = pageSink(paths, () => ["opaque-provider-key"]);
  const writer = new PageWriter({
    provider: provider(),
    maxOutputTokens: 2000,
    contextWindow: 50_000,
    sink,
  });
  const detailed: ContextMessage[] = [
    { role: "user", content: "Implement authentication" },
    {
      role: "assistant",
      content: "Validated the existing redirect",
      toolCalls: [
        { id: "auth-read", name: "read", args: { path: "ui/auth.ts", detail: "x".repeat(1000) } },
      ],
    },
    {
      role: "tool",
      toolCallId: "auth-read",
      name: "read",
      content: `${"Output detail\n".repeat(800)}Asteria callback preserves redirect_to=dashboard\napiKey=sk-secretsecretsecret\nopaque-provider-key`,
    },
  ];
  const context = await writer.write([{ role: "user", content: "Implement authentication" }], {
    profile: PROFILE_4,
    targetTokens: 4000,
    archiveMessages: detailed,
  });
  expect(context).not.toContain("Asteria");
  expect(context).toContain("context search");
  const restarted = pageSink(paths);
  expect(await restarted.count?.()).toBe(1);
  expect((await restarted.archive?.list())?.output).toContain("Page 1: summary and transcript");
  const found = await restarted.archive?.search({ query: "Asteria" });
  expect(found?.ok).toBe(true);
  expect(found?.output).toContain("Page 1 transcript:");
  expect(found?.output).toContain("redirect_to=dashboard");
  const first = await restarted.archive?.read({ page: 1, kind: "transcript", limit: 4 });
  expect(first?.output).toContain("offset=5");
  const detail = await restarted.archive?.read({
    page: 1,
    kind: "transcript",
    offset: 800,
    limit: 100,
  });
  expect(detail?.output).toContain("Asteria callback");
  expect(detail?.output).not.toContain("sk-secretsecretsecret");
  expect(detail?.output).not.toContain("opaque-provider-key");
  expect(detail?.provenance?.source).toBe("file");
  const transcript = await Bun.file(join(paths.pages, "1.transcript.md")).text();
  expect(transcript).toContain("x".repeat(1000));
});

test("a failed or aborted archive save never commits writer state", async () => {
  const writer = new PageWriter({
    provider: provider(),
    maxOutputTokens: 2000,
    contextWindow: 50_000,
    sink: {
      write: async () => {
        throw new Error("archive disk unavailable");
      },
    },
  });
  await expect(
    writer.write([{ role: "user", content: "Complete page" }], {
      profile: PROFILE_4,
      targetTokens: 4000,
    }),
  ).rejects.toThrow("archive disk unavailable");
  expect(writer.pages).toBe(0);
  expect(writer.last).toBeUndefined();
  const cwd = await workspace();
  const paths = sessionPaths(cwd, "s_aborted");
  const controller = new AbortController();
  controller.abort();
  await expect(
    pageSink(paths).write(1, "summary", "transcript", controller.signal),
  ).rejects.toThrow();
  expect(await pageSink(paths).count?.()).toBe(0);
});

test("archive validates page arguments, reports missing pages and refuses symlink escapes", async () => {
  const cwd = await workspace();
  const sink = pageSink(sessionPaths(cwd, "s_guarded"));
  await sink.write(1, "summary", "transcript");
  expect((await sink.archive?.read({ page: 0 }))?.ok).toBe(false);
  expect((await sink.archive?.read({ page: 2 }))?.ok).toBe(false);
  const paths = sessionPaths(cwd, "s_guarded");
  await symlink(join(paths.pages, "1.md"), join(paths.pages, "2.md"));
  expect((await sink.archive?.read({ page: 2 }))?.ok).toBe(false);
  const outside = await workspace();
  await mkdir(sessionPaths(cwd, "s_escaped").session, { recursive: true });
  await symlink(outside, sessionPaths(cwd, "s_escaped").pages);
  expect((await pageSink(sessionPaths(cwd, "s_escaped")).archive?.list())?.ok).toBe(false);
});

test("forks retain committed archives and rewrite pointers without copying later pages", async () => {
  const cwd = await workspace();
  const paths = sessionPaths(cwd, "s_source");
  const sink = pageSink(paths);
  await sink.write(1, "Summary of completed auth", "Original auth decision");
  await sink.write(2, "Future dashboard summary", "Future dashboard detail");
  const events: Event[] = [
    {
      type: "session.started",
      sessionId: "s_source",
      provider: "test",
      model: "test",
      prompt: "Build app",
    },
    {
      type: "context.compacted",
      sessionId: "s_source",
      page: 1,
      pruned: 0,
      kept: 0,
      summary: `Saved ${join(paths.pages, "1.md")} and ${paths.logs}`,
      path: join(paths.pages, "1.md"),
    },
  ];
  for (const event of events) await appendEvent(paths.events, event);
  await listSessions(cwd);
  const fork = await forkSession(cwd, "s_source");
  const target = sessionPaths(cwd, fork.id);
  const archive = pageSink(target);
  expect(await archive.count?.()).toBe(1);
  expect((await archive.archive?.search({ query: "Original auth decision" }))?.output).toContain(
    "transcript",
  );
  expect((await archive.archive?.search({ query: "Future dashboard" }))?.output).not.toContain(
    "Future dashboard detail",
  );
  const compacted = (await readSession(cwd, fork.id)).find(
    (event) => event.type === "context.compacted",
  );
  expect(compacted?.type === "context.compacted" ? compacted.path : "").toBe(
    join(target.pages, "1.md"),
  );
  expect(compacted?.type === "context.compacted" ? compacted.summary : "").not.toContain(
    paths.session,
  );
  await rm(paths.session, { recursive: true });
  expect((await archive.archive?.read({ page: 1, kind: "transcript" }))?.output).toContain(
    "Original auth decision",
  );
});

test("archive retrieval honors denied descendants", async () => {
  const cwd = await workspace();
  const paths = sessionPaths(cwd, "s_access");
  const sink = pageSink(paths);
  await sink.write(1, "private summary", "private transcript");
  const denied = async () => false;
  expect((await sink.archive?.list(denied))?.output).not.toContain("Page 1");
  expect((await sink.archive?.read({ page: 1 }, denied))?.ok).toBe(false);
  expect((await sink.archive?.search({ query: "private" }, denied))?.data).toMatchObject({
    count: 0,
  });
});

test("conversation forks carry the Worker's own archives and rewrite nested page pointers", async () => {
  const cwd = await workspace();
  const paths = sessionPaths(cwd, "s_dialogue");
  const worker = sessionPaths(cwd, "s_dialogue_worker");
  await pageSink(worker).write(1, "Worker summary", "Worker detail survives source deletion");
  const events: Event[] = [
    {
      type: "session.started",
      sessionId: "s_dialogue",
      role: "talker",
      provider: "test",
      model: "test",
      prompt: "Build app",
    },
    {
      type: "worker.event",
      sessionId: "s_dialogue",
      event: {
        type: "context.compacted",
        sessionId: "s_dialogue_worker",
        page: 1,
        pruned: 0,
        kept: 0,
        summary: `Worker saved ${join(worker.pages, "1.md")}`,
        path: join(worker.pages, "1.md"),
      },
    },
  ];
  for (const event of events) await appendEvent(paths.events, event);
  await listSessions(cwd);
  const fork = await forkSession(cwd, "s_dialogue");
  const target = sessionPaths(cwd, `${fork.id}_worker`);
  await rm(worker.session, { recursive: true });
  expect((await pageSink(target).archive?.read({ page: 1, kind: "transcript" }))?.output).toContain(
    "Worker detail survives",
  );
  const nested = (await readSession(cwd, fork.id)).find((event) => event.type === "worker.event");
  expect(nested?.type === "worker.event" && nested.event.sessionId).toBe(`${fork.id}_worker`);
  expect(
    nested?.type === "worker.event" &&
      nested.event.type === "context.compacted" &&
      nested.event.path,
  ).toBe(join(target.pages, "1.md"));
});
