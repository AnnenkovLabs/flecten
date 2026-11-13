import { describe, expect, test } from "bun:test";
import { groupActions } from "../../ui/src/lib/run/action-groups";
import type { RunAction } from "../../ui/src/lib/types";

function call(id: string, tool: string | undefined, extra: Partial<RunAction> = {}): RunAction {
  return {
    id,
    ...(tool === undefined ? {} : { tool }),
    icon: "file",
    label: id,
    duration: "",
    ...extra,
  };
}

describe("action groups", () => {
  test("folds a streak of reads and searches into one entry", () => {
    const entries = groupActions([
      call("a", "read", { detail: { durationMs: 400 } }),
      call("b", "grep", { detail: { durationMs: 1100 } }),
      call("c", "read"),
      call("d", "glob"),
    ]);
    expect(entries).toHaveLength(1);
    const [group] = entries;
    if (group?.kind !== "group") throw new Error("expected a group");
    expect(group.id).toBe("group-a");
    expect(group.label).toBe("Прочитано файлов: 2 · Поисков: 2");
    expect(group.duration).toBe("1.5 с");
    expect(group.actions.map((action) => action.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("keeps a lone read, edits and notes as plain rows", () => {
    const entries = groupActions([
      call("a", "read"),
      call("b", "edit"),
      call("c", "grep"),
      call("note", undefined),
      call("d", "glob"),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "action",
      "action",
      "action",
      "action",
      "action",
    ]);
  });

  test("an edit splits two streaks and each keeps the id of its first call", () => {
    const entries = groupActions([
      call("a", "read"),
      call("b", "read"),
      call("c", "edit"),
      call("d", "grep"),
      call("e", "grep"),
      call("f", "grep"),
      call("g", "grep"),
      call("h", "grep"),
    ]);
    expect(entries.map((entry) => (entry.kind === "group" ? entry.id : entry.action.id))).toEqual([
      "group-a",
      "c",
      "group-d",
    ]);
    const last = entries[2];
    if (last?.kind !== "group") throw new Error("expected a group");
    expect(last.label).toBe("Поисков: 5");
    expect(entries[0]?.kind === "group" && entries[0].label).toBe("Прочитано файлов: 2");
  });

  test("a running or failed call shows on the closed group", () => {
    const [running] = groupActions([call("a", "read"), call("b", "grep", { running: true })]);
    if (running?.kind !== "group") throw new Error("expected a group");
    expect(running.running).toBe(true);
    expect(running.duration).toBe("…");
    expect(running.failed).toBe(false);

    const [failed] = groupActions([call("a", "read", { failed: true }), call("b", "read")]);
    if (failed?.kind !== "group") throw new Error("expected a group");
    expect(failed.failed).toBe(true);
    expect(failed.duration).toBe("");
  });
});
