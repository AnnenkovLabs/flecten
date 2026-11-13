import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { z } from "zod";
import { PermissionsConfigSchema } from "../../src/config/schema";

type Compare = (
  kind: string,
  documented: string[],
  actual: string[],
  docPath: string,
  sourcePath: string,
) => string[];

const { checkConfigValue, compareDocumented, compareMissing } =
  require("../../scripts/docs-check.mjs") as {
    checkConfigValue(value: unknown, schema: unknown, where?: string): string[];
    compareDocumented: Compare;
    compareMissing: Compare;
  };
const { parseJsonBlocks, parseProtocolCommands, parseTableNames, parseToolNames } =
  require("../../scripts/docs/markdown.mjs") as {
    parseJsonBlocks(markdown: string): Array<{ line: number; value?: unknown; error?: string }>;
    parseProtocolCommands(markdown: string): string[];
    parseTableNames(markdown: string, heading: string): string[];
    parseToolNames(markdown: string): string[];
  };
const { extractStringUnion, extractUnionMembers, objectLiteralStrings } =
  require("../../scripts/docs/source.mjs") as {
    extractStringUnion(ts: unknown, source: string, typeName: string, fileName: string): string[];
    extractUnionMembers(
      ts: unknown,
      source: string,
      typeName: string,
      fileName: string,
      referencedSources?: Array<{ source: string; fileName: string }>,
    ): Map<string, Set<string>>;
    objectLiteralStrings(
      ts: unknown,
      source: string,
      fileName: string,
      key: string,
      callee?: string,
    ): string[];
  };

const permissionsSchema = z.toJSONSchema(PermissionsConfigSchema, { io: "input" });

const protocolDoc = [
  "## Команды",
  "",
  "`run` запускает сессию.",
  "",
  "`stop` просит остановиться.",
  "",
  "```json",
  '{ "type": "run", "prompt": "hello" }',
  "```",
  "",
  "| Команда | Поля |",
  "|---|---|",
  "| `queue.add` | `text` |",
  "",
  "## События",
  "",
  "`ghost` не команда.",
  "",
  "| Событие | Полезная нагрузка |",
  "|---|---|",
  "| `turn.started` | `turn` |",
  "| `usage` | `usage` |",
  "| нет кода | строка без имени |",
  "",
  "## Ошибки",
  "",
  "| `cancelled` | задачу остановили |",
].join("\n");

const toolsDoc = [
  "| Тул | Аргументы |",
  "|---|---|",
  "| `read` | `path` |",
  "| `write` | `path`, `content` |",
].join("\n");

describe("docs-check parser", () => {
  test("follows named event unions including shared child envelopes", () => {
    const events = extractUnionMembers(
      ts,
      'type Event = Leaf | Child<Leaf>; type Leaf = { type: "message.delta"; text: string };',
      "Event",
      "events.ts",
      [{ source: 'type Child<T> = { type: "subagent.event"; event: T };', fileName: "shared.ts" }],
    );
    expect([...events.keys()]).toEqual(["message.delta", "subagent.event"]);
  });
  test("extracts commands only from the protocol commands section", () => {
    expect(parseProtocolCommands(protocolDoc)).toEqual(["run", "stop", "queue.add"]);
  });

  test("reads table names of one section only", () => {
    expect(parseTableNames(protocolDoc, "События")).toEqual(["turn.started", "usage"]);
    expect(parseTableNames(protocolDoc, "Ошибки")).toEqual(["cancelled"]);
    expect(parseTableNames(protocolDoc, "Нет такого")).toEqual([]);
  });

  test("extracts documented tool names from the table", () => {
    expect(parseToolNames(toolsDoc)).toEqual(["read", "write"]);
  });

  test("parses fenced json blocks with their line numbers", () => {
    const blocks = parseJsonBlocks(protocolDoc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.line).toBe(7);
    expect(blocks[0]?.value).toEqual({ type: "run", prompt: "hello" });
  });

  test("accepts matching documented commands, tools and config fields", () => {
    const issues = [
      ...compareDocumented(
        "command",
        parseProtocolCommands(protocolDoc),
        ["run", "stop", "queue.add"],
        "docs/PROTOCOL.md",
        "src/core/types/command.ts",
      ),
      ...compareDocumented(
        "tool",
        parseToolNames(toolsDoc),
        ["read", "write"],
        "docs/TOOLS.md",
        "builtinTools()",
      ),
      ...checkConfigValue({ read: "auto", rules: [] }, permissionsSchema),
    ];
    expect(issues).toEqual([]);
  });

  test("reports precise mismatches for commands, tools and config fields", () => {
    const issues = [
      ...compareDocumented(
        "command",
        ["run", "ghost"],
        ["run"],
        "docs/PROTOCOL.md",
        "src/core/types/command.ts",
      ),
      ...compareDocumented(
        "tool",
        ["read", "teleport"],
        ["read"],
        "docs/TOOLS.md",
        "builtinTools()",
      ),
      ...checkConfigValue({ read: "auto", bogus: true }, permissionsSchema, "docs/EXTENSIONS.md:1"),
    ];
    issues.push(
      ...compareMissing(
        "event",
        ["usage"],
        ["usage", "budget"],
        "docs/PROTOCOL.md",
        "the Event type",
      ),
    );
    expect(issues).toEqual([
      'docs/PROTOCOL.md: documented command "ghost" is not exported by src/core/types/command.ts',
      'docs/TOOLS.md: documented tool "teleport" is not exported by builtinTools()',
      'docs/EXTENSIONS.md:1: unknown config field "$.bogus"',
      'docs/PROTOCOL.md: event "budget" from the Event type is not documented',
    ]);
  });
});

describe("docs-check source readers", () => {
  const source = [
    'type Code = "a" | "b";',
    'type Event = { type: "x.started"; id: string } | { type: "x.done"; ok: boolean };',
    'write({ type: "status", code: "boot" });',
    'const menu = [{ type: "separator" }];',
    'send({ type: "agent.exit", code: null });',
    'send(flag ? { type: "response", ok: false } : { type: "error", code: "protocol" });',
  ].join("\n");

  test("reads string and object unions by their literals", () => {
    expect(extractStringUnion(ts, source, "Code", "x.ts")).toEqual(["a", "b"]);
    const members = extractUnionMembers(ts, source, "Event", "x.ts");
    expect([...members.keys()]).toEqual(["x.started", "x.done"]);
    expect([...(members.get("x.done") ?? [])]).toEqual(["type", "ok"]);
  });

  test("collects literal values, optionally only inside one function's arguments", () => {
    expect(objectLiteralStrings(ts, source, "x.ts", "type")).toEqual([
      "status",
      "separator",
      "agent.exit",
      "response",
      "error",
    ]);
    expect(objectLiteralStrings(ts, source, "x.mjs", "type", "send")).toEqual([
      "agent.exit",
      "response",
      "error",
    ]);
    expect(objectLiteralStrings(ts, source, "x.mjs", "code", "send")).toEqual(["protocol"]);
  });
});
