import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantWords, userWords } from "../../src/twin/source-formats";
import {
  discoverSource,
  readSession,
  sourceDefinitions,
  sourceMessages,
} from "../../src/twin/sources";

const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});

test("source schemas distinguish human reactions, assistant context and tool blocks", () => {
  expect(
    userWords("claude", {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", text: "malicious opinion" },
          { type: "text", text: "I dislike this" },
        ],
      },
    }),
  ).toEqual(["I dislike this"]);
  expect(
    userWords("claude", {
      type: "user",
      isMeta: true,
      message: { role: "user", content: "Context injection" },
    }),
  ).toEqual([]);
  expect(
    userWords("codex", {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Love this" }],
      },
    }),
  ).toEqual(["Love this"]);
  expect(
    assistantWords("codex", {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Built the layout" }],
      },
    }),
  ).toEqual(["Built the layout"]);
  expect(
    userWords("omp", {
      type: "message",
      message: { role: "toolResult", content: [{ type: "text", text: "Never do this" }] },
    }),
  ).toEqual([]);
  expect(userWords("kilo", { role: "assistant", content: "My own preferences" })).toEqual([]);
});

test("metadata discovery counts actual files, excludes links, pairs source text only after training read", async () => {
  const home = await mkdtemp(join(tmpdir(), "twin-sources-"));
  paths.push(home);
  const definition = sourceDefinitions(home, home).find((source) => source.id === "omp");
  if (!definition) throw new Error("Source definition missing");
  await mkdir(definition.path, { recursive: true });
  await Bun.write(
    join(definition.path, "session.jsonl"),
    [
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "I added a modal" }] },
      },
      { type: "message", message: { role: "user", content: "No modal. Keep it inline." } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  const source = await discoverSource(definition, new AbortController().signal);
  expect(source.source.sessions).toBe(1);
  const file = source.files[0];
  if (!file) throw new Error("Session missing");
  const messages = await readSession(source, file, [], new AbortController().signal);
  expect(messages[0]).toMatchObject({
    text: "No modal. Keep it inline.",
    precedingAssistant: "I added a modal",
  });
  const cursor = sourceDefinitions(home, home).find((source) => source.id === "cursor");
  if (!cursor) throw new Error("Cursor missing");
  await mkdir(cursor.path, { recursive: true });
  expect((await discoverSource(cursor, new AbortController().signal)).source.status).toBe(
    "unsupported",
  );
});

test("OpenCode database validates native schema, reads only explicit non-synthetic human parts", async () => {
  const home = await mkdtemp(join(tmpdir(), "twin-opencode-"));
  paths.push(home);
  const definition = sourceDefinitions(home, home).find((source) => source.id === "opencode");
  if (!definition) throw new Error("Source definition missing");
  await mkdir(definition.path, { recursive: true });
  const db = new Database(join(definition.path, "opencode.db"));
  db.exec(
    "CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, data TEXT); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, data TEXT)",
  );
  db.query("INSERT INTO session VALUES (?, ?, ?)").run("session1", null, "{}");
  db.query("INSERT INTO session VALUES (?, ?, ?)").run(
    "session_sub",
    "session1",
    JSON.stringify({ parentID: "session1" }),
  );
  db.query("INSERT INTO message VALUES (?, ?, ?)").run(
    "u",
    "session1",
    JSON.stringify({ role: "user" }),
  );
  db.query("INSERT INTO message VALUES (?, ?, ?)").run(
    "a",
    "session1",
    JSON.stringify({ role: "assistant" }),
  );
  db.query("INSERT INTO message VALUES (?, ?, ?)").run(
    "u_sub",
    "session_sub",
    JSON.stringify({ role: "user" }),
  );
  const add = db.query("INSERT INTO part VALUES (?, ?, ?)");
  add.run("p1", "u", JSON.stringify({ type: "text", text: "Make it inline" }));
  add.run("p2", "u", JSON.stringify({ type: "text", text: "Injected", synthetic: true }));
  add.run("p3", "a", JSON.stringify({ type: "text", text: "Assistant view" }));
  add.run("p4", "u_sub", JSON.stringify({ type: "text", text: "Subagent task prompt" }));
  db.close();
  const source = await discoverSource(definition, new AbortController().signal);
  expect(source.source).toMatchObject({ status: "ready", sessions: 1 });
  const messages = await sourceMessages(source, [], new AbortController().signal);
  expect(messages.map((message) => message.text)).toEqual(["Make it inline"]);
});

test("filters out subagent and service sessions across Claude, Codex, OMP, Flecten, OpenCode v2 and Hermes", async () => {
  const home = await mkdtemp(join(tmpdir(), "twin-subagents-"));
  paths.push(home);
  await mkdir(join(home, ".claude/projects/demo/subagents"), { recursive: true });
  await mkdir(join(home, ".codex/sessions/2026"), { recursive: true });
  await mkdir(join(home, ".omp/agent/sessions/workspace/parent"), { recursive: true });
  await mkdir(join(home, ".flecten/sessions/s1"), { recursive: true });
  await mkdir(join(home, ".flecten/sessions/s1_worker"), { recursive: true });
  await mkdir(join(home, ".hermes/sessions"), { recursive: true });
  await mkdir(join(home, ".local/share/opencode"), { recursive: true });

  await Bun.write(
    join(home, ".claude/projects/demo/main.jsonl"),
    [
      { type: "user", message: { role: "user", content: "Direct user prompt" } },
      {
        type: "user",
        sourceToolAssistantUUID: "tool-1",
        message: { role: "user", content: "Tool output mirror" },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  await Bun.write(
    join(home, ".claude/projects/demo/sidechain.jsonl"),
    JSON.stringify({
      type: "user",
      isSidechain: true,
      agentId: "sub-1",
      message: { role: "user", content: "Sidechain subagent prompt" },
    }),
  );
  await Bun.write(
    join(home, ".claude/projects/demo/subagents/child.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: "Subagent folder prompt" } }),
  );

  await Bun.write(
    join(home, ".codex/sessions/2026/root.jsonl"),
    [
      { type: "session_meta", payload: { source: "vscode", thread_source: "user" } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS.md instructions" }],
          internal_chat_message_metadata_passthrough: {
            content_item_kinds: ["agents_md.instructions"],
            content_item_metadata: [{ provenance: { type: "agents_md" } }],
          },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Real Codex user reaction" }],
          internal_chat_message_metadata_passthrough: {
            content_item_kinds: ["user.text"],
            content_item_metadata: [{ provenance: { type: "user" } }],
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  await Bun.write(
    join(home, ".codex/sessions/2026/subagent.jsonl"),
    [
      {
        type: "session_meta",
        payload: {
          source: { subagent: { thread_spawn: { parent_thread_id: "root-id", depth: 1 } } },
          thread_source: "subagent",
          parent_thread_id: "root-id",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Codex subagent instructions" }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  await Bun.write(
    join(home, ".omp/agent/sessions/workspace/root.jsonl"),
    [
      { type: "session", id: "omp-1" },
      { type: "message", message: { role: "user", content: "Real OMP user prompt" } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  await Bun.write(
    join(home, ".omp/agent/sessions/workspace/sub.jsonl"),
    [
      { type: "session", id: "omp-sub", parentSession: "omp-1" },
      { type: "message", message: { role: "user", content: "OMP parentSession subagent" } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  await Bun.write(
    join(home, ".omp/agent/sessions/workspace/parent/nested.jsonl"),
    [
      { type: "session", id: "omp-nested" },
      { type: "message", message: { role: "user", content: "OMP nested subagent" } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  await Bun.write(
    join(home, ".flecten/sessions/s1/events.jsonl"),
    [
      { event: { type: "session.started", prompt: "Real Flecten user prompt" } },
      { event: { type: "session.started", prompt: "Twin message", actor: "twin" } },
      { event: { type: "steer.applied", text: "Twin steer", actor: "twin" } },
      { event: { type: "steer.applied", text: "Real Flecten steer" } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  await Bun.write(
    join(home, ".flecten/sessions/s1_worker/events.jsonl"),
    JSON.stringify({ event: { type: "session.started", prompt: "Worker session prompt" } }),
  );

  const ocDb = new Database(join(home, ".local/share/opencode/opencode.db"));
  ocDb.exec(
    "CREATE TABLE session_v2(id TEXT PRIMARY KEY, parent_id TEXT); CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)",
  );
  ocDb.query("INSERT INTO session_v2 VALUES (?, ?)").run("ses_root", null);
  ocDb.query("INSERT INTO session_v2 VALUES (?, ?)").run("ses_sub", "ses_root");
  ocDb
    .query("INSERT INTO session_message VALUES (?, ?, ?, ?)")
    .run("m1", "ses_root", "user", JSON.stringify({ text: "OpenCode v2 root user" }));
  ocDb
    .query("INSERT INTO session_message VALUES (?, ?, ?, ?)")
    .run("m2", "ses_sub", "user", JSON.stringify({ text: "OpenCode v2 subagent" }));
  ocDb.close();

  const hermesDb = new Database(join(home, ".hermes/state.db"));
  hermesDb.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT, created_source TEXT, parent_session_id TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, display_kind TEXT)",
  );
  hermesDb
    .query("INSERT INTO sessions VALUES (?, ?, ?, ?)")
    .run("h_root", "local", "desktop", null);
  hermesDb
    .query("INSERT INTO sessions VALUES (?, ?, ?, ?)")
    .run("h_sub", "subagent", "subagent", "h_root");
  hermesDb
    .query("INSERT INTO messages VALUES (?, ?, ?, ?, ?)")
    .run(1, "h_root", "user", "Hermes root user", null);
  hermesDb
    .query("INSERT INTO messages VALUES (?, ?, ?, ?, ?)")
    .run(2, "h_root", "user", "[ASYNC DELEGATION]", "async_delegation_complete");
  hermesDb
    .query("INSERT INTO messages VALUES (?, ?, ?, ?, ?)")
    .run(3, "h_sub", "user", "Hermes subagent task", null);
  hermesDb.close();

  const defs = sourceDefinitions(home, home);
  const signal = new AbortController().signal;
  const discovered = await Promise.all(
    defs.map((def) => discoverSource(def, signal, { cwd: home, home })),
  );
  const byId = new Map(discovered.map((item) => [item.source.id, item]));

  expect(byId.get("claude")?.source.sessions).toBe(1);
  expect(byId.get("codex")?.source.sessions).toBe(1);
  expect(byId.get("omp")?.source.sessions).toBe(1);
  expect(byId.get("flecten")?.source.sessions).toBe(1);
  expect(byId.get("opencode")?.source.sessions).toBe(1);
  expect(byId.get("hermes")?.source.sessions).toBe(1);

  const allMessages = (
    await Promise.all(
      discovered.flatMap((source) => [
        sourceMessages(source, [], signal),
        ...source.files.map((file) => readSession(source, file, [], signal)),
      ]),
    )
  ).flat();

  expect(allMessages.map((m) => m.text)).toEqual([
    "Direct user prompt",
    "Real Codex user reaction",
    "Real OMP user prompt",
    "OpenCode v2 root user",
    "Hermes root user",
    "Real Flecten user prompt",
    "Real Flecten steer",
  ]);
});
