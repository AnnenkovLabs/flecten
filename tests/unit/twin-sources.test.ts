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
    "CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, data TEXT)",
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
  const add = db.query("INSERT INTO part VALUES (?, ?, ?)");
  add.run("p1", "u", JSON.stringify({ type: "text", text: "Make it inline" }));
  add.run("p2", "u", JSON.stringify({ type: "text", text: "Injected", synthetic: true }));
  add.run("p3", "a", JSON.stringify({ type: "text", text: "Assistant view" }));
  db.close();
  const source = await discoverSource(definition, new AbortController().signal);
  expect(source.source).toMatchObject({ status: "ready", sessions: 1 });
  const messages = await sourceMessages(source, [], new AbortController().signal);
  expect(messages.map((message) => message.text)).toEqual(["Make it inline"]);
});
