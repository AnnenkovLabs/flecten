import { describe, expect, it } from "bun:test";
import { filterRecent, type NewSessionTask, taskAge } from "../../ui/src/lib/new-session";

function task(
  id: string,
  title: string,
  project: string,
  updatedAt: string,
  status: NewSessionTask["status"] = "done",
): NewSessionTask {
  return { id, title, project, status, updatedAt };
}

describe("taskAge", () => {
  const now = new Date(2026, 9, 25, 15, 0, 0);
  const ago = (milliseconds: number): string =>
    new Date(now.getTime() - milliseconds).toISOString();

  it("uses compact relative units", () => {
    expect(taskAge(ago(20_000), now)).toBe("сейчас");
    expect(taskAge(ago(5 * 60_000), now)).toBe("5 мин");
    expect(taskAge(ago(3 * 3_600_000), now)).toBe("3 ч");
    expect(taskAge(ago(2 * 86_400_000), now)).toBe("2 д");
  });

  it("falls back to a date after a week", () => {
    expect(taskAge(new Date(2026, 9, 12, 12, 0, 0).toISOString(), now)).toBe("12 окт.");
    expect(taskAge(new Date(2025, 9, 12, 12, 0, 0).toISOString(), now)).toBe("12 окт. 2025 г.");
  });

  it("handles future and invalid values", () => {
    expect(taskAge(ago(-60_000), now)).toBe("сейчас");
    expect(taskAge("not-a-date", now)).toBe("");
  });
});

describe("filterRecent", () => {
  const tasks = [
    task("a", "Починить тесты", "Лихтенштейн", "2026-10-24T10:00:00.000Z"),
    task("b", "Добавить экран", "liquidharness", "2026-10-25T10:00:00.000Z"),
    task("c", "Обновить README", "liquidharness", "2026-10-23T10:00:00.000Z"),
  ];

  it("sorts by update time and applies the limit", () => {
    expect(filterRecent(tasks, "", 2).map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(filterRecent(tasks, "", 0)).toEqual([]);
  });

  it("matches title and project without case", () => {
    expect(filterRecent(tasks, "ТЕСТЫ").map((entry) => entry.id)).toEqual(["a"]);
    expect(filterRecent(tasks, " liquid ").map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("keeps the input order intact", () => {
    filterRecent(tasks, "", 3);
    expect(tasks.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("puts tasks without a valid date last", () => {
    const withInvalid = [...tasks, task("d", "Без даты", "проект", "")];
    expect(filterRecent(withInvalid, "", 4).map((entry) => entry.id)).toEqual(["b", "a", "c", "d"]);
  });
});
