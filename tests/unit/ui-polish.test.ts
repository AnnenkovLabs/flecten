import { describe, expect, it } from "bun:test";
import type { ThreadItem } from "../../ui/src/lib/types";
import {
  answerDisplayText,
  moveDraft,
  searchScore,
  searchThread,
  taskStatus,
  updateDraft,
} from "../../ui/src/lib/ui-polish";

describe("draft map", () => {
  it("keeps one draft per task and removes empty drafts", () => {
    let drafts = updateDraft({}, "task-a", "первое сообщение");
    drafts = updateDraft(drafts, "task-b", "второе сообщение");

    expect(drafts).toEqual({
      "task-a": "первое сообщение",
      "task-b": "второе сообщение",
    });

    drafts = updateDraft(drafts, "task-a", "");
    expect(drafts).toEqual({ "task-b": "второе сообщение" });
    expect(updateDraft(drafts, "task-a", "")).toBe(drafts);
    expect(updateDraft(drafts, "", "orphan")).toBe(drafts);
  });

  it("moves a draft from the new task slot to the started session", () => {
    const drafts = updateDraft({}, "current", "текст до старта");

    expect(moveDraft(drafts, "current", "session-1")).toEqual({
      "session-1": "текст до старта",
    });
    expect(moveDraft(drafts, "current", "current")).toBe(drafts);
    expect(moveDraft({}, "current", "session-1")).toEqual({});
  });
});

describe("answer display text", () => {
  it("does not repeat a summary that is the whole answer", () => {
    expect(answerDisplayText("Приветики! Чем помочь?", "Приветики! Чем помочь?")).toBe("");
    expect(answerDisplayText("  Приветики!  ", "Приветики!")).toBe("");
  });

  it("keeps prose when the summary adds something else", () => {
    expect(answerDisplayText("Готово.", "Тесты проходят, файлы изменены.")).toBe("Готово.");
  });

  it("keeps the answer when there is no summary", () => {
    expect(answerDisplayText("Готово.")).toBe("Готово.");
  });
});

describe("task status mapping", () => {
  const idle = { running: false, approvals: 0, interrupted: false };
  const running = { ...idle, running: true };

  it("marks the running task as working regardless of the last stop reason", () => {
    expect(taskStatus("done", running)).toBe("working");
    expect(taskStatus(undefined, running)).toBe("working");
    expect(taskStatus("error", running)).toBe("working");
  });

  it("puts a waiting approval and an interrupted run before the stop reason", () => {
    expect(taskStatus(undefined, { ...running, approvals: 1 })).toBe("waiting");
    expect(taskStatus("done", { ...idle, interrupted: true })).toBe("interrupted");
  });

  it("maps every terminal stop reason to a distinct status", () => {
    expect(taskStatus("done", idle)).toBe("done");
    expect(taskStatus("end", idle)).toBe("done");
    expect(taskStatus("stopped", idle)).toBe("stopped");
    expect(taskStatus("budget", idle)).toBe("stopped");
    expect(taskStatus("error", idle)).toBe("error");
    expect(taskStatus("max_turns", idle)).toBe("error");
    expect(taskStatus(undefined, idle)).toBe("review");
  });
});

describe("thread search scoring", () => {
  it("prefers an exact match over an interior match", () => {
    const exact = searchScore("парсер", "парсер");
    const interior = searchScore("обнови парсер заново", "парсер");

    expect(exact).toBeGreaterThan(interior);
    expect(interior).toBeGreaterThan(0);
    expect(searchScore("нет совпадений", "парсер")).toBe(0);
    expect(searchScore("парсер", "  ")).toBe(0);
  });

  it("counts every occurrence", () => {
    expect(searchScore("парсер и парсер", "парсер")).toBeGreaterThan(
      searchScore("парсер и тесты", "парсер"),
    );
  });
});

describe("thread search", () => {
  const items: ThreadItem[] = [
    { kind: "message", id: "m1", text: "Исправь парсер" },
    { kind: "answer", id: "a1", text: "Готово. Парсер обновлён, тесты проходят." },
    {
      kind: "run",
      id: "r1",
      summary: {
        duration: "1 с",
        actions: 1,
        criteria: 0,
        list: [{ id: "tool-1", icon: "terminal", label: "bun test", duration: "1 с" }],
        turns: [],
        text: "",
        files: [],
      },
    },
    { kind: "error", id: "e1", text: "provider timeout", code: "provider_failed" },
  ];

  it("finds messages, answers, actions and errors in document order", () => {
    expect(searchThread(items, "парсер").map((hit) => hit.id)).toEqual(["m1", "a1"]);
    expect(searchThread(items, "bun test").map((hit) => hit.id)).toEqual(["r1"]);
    expect(searchThread(items, "provider").map((hit) => hit.id)).toEqual(["e1"]);
  });

  it("ignores an empty query and text outside the thread", () => {
    expect(searchThread(items, "")).toEqual([]);
    expect(searchThread(items, "   ")).toEqual([]);
    expect(searchThread(items, "квантовая физика")).toEqual([]);
  });
});
