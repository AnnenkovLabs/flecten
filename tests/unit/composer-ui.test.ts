import { describe, expect, it } from "bun:test";
import {
  BUILTIN_COMMANDS,
  filterCommands,
  parseCommandQuery,
} from "../../ui/src/lib/composer/commands";
import { filterMentions, fuzzyScore } from "../../ui/src/lib/composer/mentions";
import {
  canSend,
  emptyQueue,
  formatBytes,
  queueTransitions,
} from "../../ui/src/lib/composer/queue";
import type {
  Attachment,
  MentionItem,
  QueuedMessage,
  SendMode,
} from "../../ui/src/lib/composer/types";

const mentionItems: MentionItem[] = [
  { path: "ui/src/components/Composer.svelte", kind: "file", fileKind: "ts" },
  { path: "ui/src/components/composer/MentionMenu.svelte", kind: "file", fileKind: "ts" },
  { path: "ui/src/components/composer", kind: "folder" },
  { path: "docs/design.md", kind: "file", fileKind: "md", preview: "# Flecten: Design" },
];

function attachment(id: string, size = 1024): Attachment {
  return { id, name: `${id}.png`, size, kind: "image" };
}

function message(
  id: string,
  mode: SendMode = "queue",
  state: QueuedMessage["state"] = "pending",
): QueuedMessage {
  return { id, text: `message ${id}`, mode, state };
}

describe("fuzzyScore", () => {
  it("matches characters in order and ignores case", () => {
    expect(fuzzyScore("cmp", "Composer.ts")).not.toBeNull();
    expect(fuzzyScore("CMP", "composer.ts")).not.toBeNull();
    expect(fuzzyScore("cms", "components")).not.toBeNull();
  });

  it("rejects missing characters and keeps empty queries neutral", () => {
    expect(fuzzyScore("zzz", "composer.ts")).toBeNull();
    expect(fuzzyScore("pmc", "composer.ts")).toBeNull();
    expect(fuzzyScore("", "composer.ts")).toBe(0);
  });

  it("prefers a segment start over an interior match", () => {
    const start = fuzzyScore("cmp", "components/Composer.ts");
    const middle = fuzzyScore("cmp", "decompose.ts");

    expect(start).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(start ?? 0).toBeGreaterThan(middle ?? 0);
  });
});

describe("filterMentions", () => {
  it("finds files and folders by a fuzzy path query", () => {
    expect(filterMentions("ment", mentionItems)[0]?.path).toBe(
      "ui/src/components/composer/MentionMenu.svelte",
    );

    const composer = filterMentions("composer", mentionItems).map((item) => item.path);
    expect(composer).toContain("ui/src/components/Composer.svelte");
    expect(composer).toContain("ui/src/components/composer");
  });

  it("matches the file name more strongly than the directory path", () => {
    expect(filterMentions("design", mentionItems)[0]?.path).toBe("docs/design.md");
  });

  it("returns the provided order for an empty query and respects the limit", () => {
    expect(filterMentions("", mentionItems, 2).map((item) => item.path)).toEqual([
      "ui/src/components/Composer.svelte",
      "ui/src/components/composer/MentionMenu.svelte",
    ]);
  });

  it("returns nothing when no character sequence matches", () => {
    expect(filterMentions("qqq", mentionItems)).toEqual([]);
  });
});

describe("filterCommands", () => {
  it("exposes every built-in command", () => {
    expect(BUILTIN_COMMANDS.map((command) => command.name)).toEqual([
      "continue",
      "undo",
      "redo",
      "checkpoints",
      "compact",
      "clear",
      "model",
      "permissions",
      "terminal",
      "new",
      "search",
      "export",
    ]);
    expect(BUILTIN_COMMANDS.every((command) => command.source === "builtin")).toBe(true);
  });

  it("filters built-ins by name and description", () => {
    expect(filterCommands("un")[0]?.name).toBe("undo");
    expect(filterCommands("терминал").map((command) => command.name)).toContain("terminal");
  });

  it("adds provided skills as a separate source", () => {
    const skills = [{ name: "review", description: "Проверка кода проекта" }];
    const review = filterCommands("rev", skills).find((command) => command.name === "review");

    expect(review?.source).toBe("skill");
    expect(filterCommands("rev", skills)[0]?.source).toBe("skill");
  });

  it("ignores the argument part when filtering", () => {
    expect(filterCommands("compact тема").map((command) => command.name)).toEqual(["compact"]);
  });

  it("shows argument hints", () => {
    const compact = filterCommands("compact").find((command) => command.name === "compact");
    expect(compact?.hint).toBe("[тема]");
  });

  it("parses a slash command and its raw arguments", () => {
    expect(parseCommandQuery("/compact тема")).toEqual({ name: "compact", args: "тема" });
    expect(parseCommandQuery("/model gpt 5")).toEqual({ name: "model", args: "gpt 5" });
    expect(parseCommandQuery("undo")).toEqual({ name: "undo", args: "" });
    expect(parseCommandQuery("  ")).toEqual({ name: "", args: "" });
  });
});

describe("queueTransitions", () => {
  it("adds unique messages in pending state", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a", "queue", "sending") });

    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.state).toBe("pending");

    const duplicate = queueTransitions(state, { type: "add", item: message("a") });
    expect(duplicate).toBe(state);
  });

  it("edits and removes only pending messages", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a") });

    const edited = queueTransitions(state, { type: "edit", id: "a", text: "  new text  " });
    expect(edited.items[0]?.text).toBe("  new text  ");

    const blank = queueTransitions(edited, { type: "edit", id: "a", text: "   " });
    expect(blank).toBe(edited);

    const removed = queueTransitions(edited, { type: "remove", id: "a" });
    expect(removed.items).toEqual([]);
  });

  it("marks a message sending exactly once", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a") });

    const sending = queueTransitions(state, { type: "begin", id: "a" });
    expect(sending.items[0]?.state).toBe("sending");

    expect(queueTransitions(sending, { type: "begin", id: "a" })).toBe(sending);

    const sent = queueTransitions(sending, { type: "sent", id: "a" });
    expect(sent.items).toEqual([]);
    expect(queueTransitions(sent, { type: "sent", id: "a" })).toBe(sent);
  });

  it("never delivers a pending message without begin", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a") });

    expect(queueTransitions(state, { type: "sent", id: "a" })).toBe(state);
  });

  it("blocks edits, removals and cancellation while sending", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a") });
    state = queueTransitions(state, { type: "begin", id: "a" });

    expect(queueTransitions(state, { type: "edit", id: "a", text: "late" })).toBe(state);
    expect(queueTransitions(state, { type: "remove", id: "a" })).toBe(state);
    expect(queueTransitions(state, { type: "cancel", id: "a" })).toBe(state);
  });

  it("cancels pending messages and keeps steer mode", () => {
    let state = emptyQueue();
    state = queueTransitions(state, { type: "add", item: message("a", "steer") });
    state = queueTransitions(state, { type: "add", item: message("b") });

    expect(state.items[0]?.mode).toBe("steer");

    const cancelled = queueTransitions(state, { type: "cancel", id: "a" });
    expect(cancelled.items.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("canSend", () => {
  it("requires text or an attachment", () => {
    expect(canSend({ text: "   ", attachments: [], mode: "queue", running: false })).toBe(false);
    expect(canSend({ text: "hello", attachments: [], mode: "queue", running: false })).toBe(true);
    expect(
      canSend({ text: "", attachments: [attachment("a")], mode: "queue", running: false }),
    ).toBe(true);
  });

  it("allows steering only during a run", () => {
    expect(canSend({ text: "hello", attachments: [], mode: "steer", running: true })).toBe(true);
    expect(canSend({ text: "hello", attachments: [], mode: "steer", running: false })).toBe(false);
    expect(
      canSend({ text: "", attachments: [attachment("a")], mode: "steer", running: false }),
    ).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats Russian sizes", () => {
    expect(formatBytes(0)).toBe("0\u00A0Б");
    expect(formatBytes(512)).toBe("512\u00A0Б");
    expect(formatBytes(1024)).toBe("1\u00A0КБ");
    expect(formatBytes(1536)).toBe("1,5\u00A0КБ");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12\u00A0МБ");
    expect(formatBytes(1536 * 1024)).toBe("1,5\u00A0МБ");
  });

  it("returns zero for invalid input", () => {
    expect(formatBytes(-10)).toBe("0\u00A0Б");
    expect(formatBytes(Number.NaN)).toBe("0\u00A0Б");
  });
});
