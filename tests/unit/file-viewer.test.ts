import { describe, expect, test } from "bun:test";
import { toolAction } from "../../ui/src/lib/agent";
import { lineNumbers, splitPath } from "../../ui/src/lib/file-text";

describe("file viewer", () => {
  test("numbers every line once, with or without a final break", () => {
    expect(lineNumbers("a\nb\n")).toBe("1\n2");
    expect(lineNumbers("a\nb")).toBe("1\n2");
    expect(lineNumbers("")).toBe("1");
  });

  test("keeps the file name whole when the folder is cut", () => {
    expect(splitPath(".liquid/sessions/s1/logs/bash-1.log")).toEqual({
      dir: ".liquid/sessions/s1/logs/",
      name: "bash-1.log",
    });
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });

  test("file tools offer their file and a read lands on its offset", () => {
    const read = toolAction(
      { id: "c1", name: "read", args: { path: "src/a.ts", offset: 120 } },
      { ok: true, output: "x" },
    );
    expect(read.detail?.file).toBe("src/a.ts");
    expect(read.detail?.line).toBe(120);

    const bash = toolAction(
      { id: "c2", name: "bash", args: { command: "ls" } },
      { ok: true, output: "x", fullOutputPath: "/p/.liquid/sessions/s/logs/bash.log" },
    );
    expect(bash.detail?.file).toBeUndefined();
    expect(bash.detail?.fullOutputPath).toBe("/p/.liquid/sessions/s/logs/bash.log");
  });
});
