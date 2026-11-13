import { describe, expect, test } from "bun:test";
import { fileKind, partialArgsPreview, toolAction, toolIcon } from "../../ui/src/lib/agent";
import { settingsSection, shouldAnimate } from "../../ui/src/lib/motion";
import { oneLine, streamingField } from "../../ui/src/lib/partial-json";
import type { AgentToolCall, AgentToolResult, DiffHunk } from "../../ui/src/lib/types";

describe("agent UI helpers", () => {
  test("shows a partial path while the tool call is still streaming", () => {
    expect(partialArgsPreview('{"path":"docs/ARCH')).toBe("docs/ARCH");
  });

  test("shows a partial command", () => {
    expect(partialArgsPreview('{"command":"bun te')).toBe("bun te");
  });

  test("hides incomplete JSON when no readable argument has arrived", () => {
    expect(partialArgsPreview('{"x":')).toBe("");
  });

  test("decodes escapes, including ones cut by the stream", () => {
    expect(partialArgsPreview('{"command":"echo \\"hi\\" \\u00e9\\nnext')).toBe('echo "hi" é next');
    expect(partialArgsPreview('{"command":"echo a\\')).toBe("echo a");
    expect(partialArgsPreview('{"command":"x\\u00')).toBe("x");
  });

  test("ignores key names inside other string values", () => {
    const args = '{"description":"set \\"path\\": \\"wrong\\"","path":"src/right.ts"}';
    expect(partialArgsPreview(args)).toBe("src/right.ts");
    expect(streamingField('{"meta":{"path":"nested"}}', ["path"])).toBe("nested");
    expect(streamingField('{"path":', ["path"])).toBeUndefined();
  });

  test("joins whitespace runs into one line", () => {
    expect(oneLine("  a\n\t b  c \r\n")).toBe("a b c");
    expect(partialArgsPreview(`{"x": ${"1, ".repeat(40)}`)).toBe("");
  });

  test("recognizes test files by their last two extensions", () => {
    expect(fileKind("src/a.test.ts")).toBe("test");
    expect(fileKind("ui/b.spec.mjs")).toBe("test");
    expect(fileKind("c.test.ctsx")).toBe("test");
    expect(fileKind("test.ts")).toBe("ts");
    expect(fileKind("dir.test/file.ts")).toBe("ts");
    expect(fileKind("notes.test.md")).toBe("md");
  });

  test("maps tool names to icons", () => {
    expect(toolIcon("read")).toBe("file");
    expect(toolIcon("bash")).toBe("terminal");
    expect(toolIcon("edit")).toBe("edit");
    expect(toolIcon("grep")).toBe("search");
  });
});

describe("expandable decision", () => {
  test("does not animate when the state did not change", () => {
    expect(shouldAnimate(false, false)).toBe(false);
    expect(shouldAnimate(true, true)).toBe(false);
  });

  test("animates when the state changes in either direction", () => {
    expect(shouldAnimate(false, true)).toBe(true);
    expect(shouldAnimate(true, false)).toBe(true);
  });
});

test("settings navigation fades only when the selected section changes", () => {
  const transitions: { frames: Keyframe[]; duration: number | undefined }[] = [];
  let cancelled = 0;
  const node = {
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      transitions.push({ frames, duration: options.duration as number | undefined });
      return { cancel: () => (cancelled += 1) };
    },
  } as unknown as HTMLElement;
  const action = settingsSection(node, "general");
  action.update("general");
  expect(transitions).toHaveLength(0);
  action.update("history");
  action.update("history");
  expect(transitions).toEqual([{ frames: [{ opacity: 0.45 }, { opacity: 1 }], duration: 140 }]);
  action.destroy();
  expect(cancelled).toBe(1);
});

describe("tool action details", () => {
  test("keeps file output, duration and hunks", () => {
    const hunks: DiffHunk[] = [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: "del", oldLine: 1, newLine: null, text: "old" },
          { kind: "add", oldLine: null, newLine: 1, text: "new" },
        ],
      },
    ];
    const call: AgentToolCall = {
      id: "call-1",
      name: "edit",
      args: { path: "src/a.ts", oldString: "old", newString: "new" },
    };
    const result: AgentToolResult = {
      ok: true,
      output: "Edited src/a.ts: 1 replacement(s), +1 -1.",
      fullOutputPath: "/tmp/call-1.log",
      durationMs: 12,
      data: { kind: "file", path: "src/a.ts", state: "M", add: 1, del: 1, hunks },
    };

    const action = toolAction(call, result, 12);

    expect(action.detail?.input).toEqual(call.args);
    expect(action.detail?.output).toBe(result.output);
    expect(action.detail?.hunks).toEqual(hunks);
    expect(action.detail?.fullOutputPath).toBe("/tmp/call-1.log");
    expect(action.detail?.durationMs).toBe(12);
    expect(action.add).toBe(1);
    expect(action.del).toBe(1);
  });

  test("keeps bash output, error and exit code", () => {
    const call: AgentToolCall = { id: "call-2", name: "bash", args: { command: "bun test" } };
    const result: AgentToolResult = {
      ok: false,
      output: "1 fail",
      error: "Command exited with code 1",
      durationMs: 5,
      data: {
        kind: "terminal",
        command: "bun test",
        exitCode: 1,
        output: "1 fail",
        timedOut: false,
        aborted: false,
      },
    };

    const action = toolAction(call, result, 5);

    expect(action.failed).toBe(true);
    expect(action.detail?.output).toBe("1 fail");
    expect(action.detail?.error).toBe("Command exited with code 1");
    expect(action.detail?.exitCode).toBe(1);
    expect(action.detail?.durationMs).toBe(5);
  });
});
