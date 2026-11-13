import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient, type LspServerConfig } from "../../src/tools/lsp/client";
import { type LspConfig, resolveRoot } from "../../src/tools/lsp/config";
import {
  type LspDiagnosticView,
  type LspLocation,
  type LspSymbol,
  type LspTextEdit,
  type LspToolContext,
  runLsp,
} from "../../src/tools/lsp/run";

const fixture = fileURLToPath(new URL("../fixtures/fake-lsp.ts", import.meta.url));
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-lsp-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string, marker: string): LspToolContext {
  return {
    cwd,
    signal: new AbortController().signal,
    lsp: {
      command: process.execPath,
      args: [fixture],
      env: { FAKE_LSP_MARKER: marker },
    },
  };
}

function toolContext(cwd: string, lsp?: LspConfig): LspToolContext {
  return {
    cwd,
    signal: new AbortController().signal,
    ...(lsp !== undefined ? { lsp } : {}),
  };
}

function clientConfig(marker?: string): LspServerConfig {
  return {
    command: process.execPath,
    args: [fixture],
    ...(marker !== undefined ? { env: { FAKE_LSP_MARKER: marker } } : {}),
  };
}

function formatterConfig(allowlist: string[] = [], timeoutMs?: number): LspConfig {
  return {
    formatters: [
      {
        command: process.execPath,
        args: [fixture, "--formatter", "{file}"],
        filetypes: ["ts"],
        envAllowlist: allowlist,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
    ],
  };
}

function params(uri: string) {
  return {
    textDocument: { uri },
    position: { line: 0, character: 6 },
  };
}

async function withEnv<T>(values: Record<string, string>, action: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("lsp diagnostics", () => {
  test("opens the file, returns structured diagnostics and shuts down cleanly", async () => {
    const cwd = await tempDir();
    const marker = join(cwd, "marker.txt");
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const result = await runLsp({ operation: "diagnostics", path: "a.ts" }, context(cwd, marker));
    const data = result.data as { kind: string; path: string; diagnostics: LspDiagnosticView[] };
    expect(result.ok).toBe(true);
    expect(data.kind).toBe("lsp");
    expect(data.path).toBe("a.ts");
    expect(data.diagnostics).toEqual([
      {
        file: "a.ts",
        line: 1,
        character: 1,
        severity: "error",
        message: "fake diagnostic",
        source: "fake",
      },
    ]);
    expect(result.output).toContain("diagnostics: 1 in a.ts");
    expect(result.output).toContain("error a.ts:1:1: fake diagnostic (fake)");
    expect(await readFile(marker, "utf8")).toBe("exit");
  });
});

describe("lsp navigation", () => {
  test("definition uses command and args from the tool call", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const result = await runLsp(
      {
        operation: "definition",
        path: "a.ts",
        line: 1,
        character: 7,
        command: process.execPath,
        args: [fixture],
      },
      { cwd, signal: new AbortController().signal },
    );
    const data = result.data as { locations: LspLocation[] };
    expect(result.ok).toBe(true);
    expect(data.locations).toEqual([
      { file: "a.ts", line: 2, character: 3 },
      { file: "/other.ts", line: 4, character: 2 },
    ]);
    expect(result.output).toContain("definition: 2 locations");
    expect(result.output).toContain("a.ts:2:3");
  });

  test("references and symbols are structured", async () => {
    const cwd = await tempDir();
    const marker = join(cwd, "marker.txt");
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");

    const references = await runLsp(
      { operation: "references", path: "a.ts", line: 1, character: 7 },
      context(cwd, marker),
    );
    const referenceData = references.data as { locations: LspLocation[] };
    expect(references.ok).toBe(true);
    expect(referenceData.locations).toEqual([
      { file: "a.ts", line: 1, character: 5 },
      { file: "a.ts", line: 3, character: 1 },
    ]);

    const symbols = await runLsp({ operation: "symbols", path: "a.ts" }, context(cwd, marker));
    const symbolData = symbols.data as { symbols: LspSymbol[] };
    expect(symbols.ok).toBe(true);
    expect(symbolData.symbols).toEqual([
      { name: "x", kind: "variable", file: "a.ts", line: 1, character: 7 },
      { name: "inner", kind: "function", file: "a.ts", line: 2, character: 3 },
    ]);
  });

  test("rename returns a structured preview", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const result = await runLsp(
      { operation: "rename", path: "a.ts", line: 1, character: 7, newName: "renamed" },
      context(cwd, "m"),
    );
    const data = result.data as { edits: LspTextEdit[] };
    expect(result.ok).toBe(true);
    expect(data.edits).toEqual([
      {
        file: "a.ts",
        line: 1,
        character: 7,
        endLine: 1,
        endCharacter: 8,
        newText: "renamed",
      },
    ]);
    expect(result.output).toContain("rename: 1 edit");
  });

  test("requires a position for definition and references", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const result = await runLsp({ operation: "definition", path: "a.ts" }, context(cwd, "m"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("line and character");
  });

  test("requires a new name for rename", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const result = await runLsp(
      { operation: "rename", path: "a.ts", line: 1, character: 7 },
      context(cwd, "m"),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("newName");
  });

  test("reports a missing file before starting a server", async () => {
    const cwd = await tempDir();
    const result = await runLsp({ operation: "symbols", path: "missing.ts" }, context(cwd, "m"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cannot read missing.ts");
  });
});

describe("lsp server config", () => {
  test("resolves the root from root markers", async () => {
    const cwd = await tempDir();
    const nested = join(cwd, "packages", "app");
    await mkdir(join(nested, "src"), { recursive: true });
    await writeFile(join(nested, "package.json"), "{}");

    expect(resolveRoot(join(nested, "src", "a.ts"), cwd, ["package.json"])).toBe(nested);
    expect(resolveRoot(join(nested, "src", "a.ts"), cwd, ["Cargo.toml"])).toBe(cwd);
  });

  test("routes files to servers by filetype", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    await writeFile(join(cwd, "b.py"), "x = 1\n");

    const lsp: LspConfig = {
      servers: [
        {
          command: process.execPath,
          args: [fixture, "--tag", "ts"],
          filetypes: ["ts"],
        },
        {
          command: process.execPath,
          args: [fixture, "--tag", "py"],
          filetypes: ["python"],
        },
      ],
    };

    const ts = await runLsp({ operation: "diagnostics", path: "a.ts" }, toolContext(cwd, lsp));
    const py = await runLsp({ operation: "diagnostics", path: "b.py" }, toolContext(cwd, lsp));

    expect((ts.data as { diagnostics: LspDiagnosticView[] }).diagnostics[0]?.message).toBe(
      "fake diagnostic ts",
    );
    expect((py.data as { diagnostics: LspDiagnosticView[] }).diagnostics[0]?.message).toBe(
      "fake diagnostic py",
    );
  });

  test("accepts config records keyed by server name", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = {
      servers: {
        fake: {
          command: process.execPath,
          args: [fixture, "--tag", "record"],
          filetypes: ["ts"],
        },
      },
    };

    const result = await runLsp({ operation: "diagnostics", path: "a.ts" }, toolContext(cwd, lsp));

    expect((result.data as { diagnostics: LspDiagnosticView[] }).diagnostics[0]?.message).toBe(
      "fake diagnostic record",
    );
  });

  test("returns a clear result when no server is configured", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = { servers: [] };

    const result = await runLsp({ operation: "symbols", path: "a.ts" }, toolContext(cwd, lsp));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No language server configured for .ts files");
  });

  test("returns a clear result when the server executable is missing", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = {
      servers: [{ command: "liquid-no-such-lsp-command", filetypes: ["ts"] }],
    };

    const result = await runLsp({ operation: "symbols", path: "a.ts" }, toolContext(cwd, lsp));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Language server not found: liquid-no-such-lsp-command");
  });

  test("only passes allowlisted env vars to the server", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = {
      servers: [
        { command: process.execPath, args: [fixture], filetypes: ["ts"], envAllowlist: [] },
      ],
    };

    await withEnv({ FAKE_LSP_SECRET: "top-secret" }, async () => {
      const result = await runLsp(
        { operation: "diagnostics", path: "a.ts" },
        toolContext(cwd, lsp),
      );
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain("top-secret");
    });
  });

  test("times out a slow server request", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = {
      servers: [
        {
          command: process.execPath,
          args: [fixture],
          filetypes: ["ts"],
          envAllowlist: ["FAKE_LSP_DELAY_MS"],
          timeoutMs: 80,
        },
      ],
    };

    await withEnv({ FAKE_LSP_DELAY_MS: "500" }, async () => {
      const result = await runLsp(
        { operation: "definition", path: "a.ts", line: 1, character: 1 },
        toolContext(cwd, lsp),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("timed out after 80ms");
    });
  });
});

describe("lsp formatters", () => {
  test("returns a structured diff without modifying the file", async () => {
    const cwd = await tempDir();
    const file = join(cwd, "a.ts");
    const original = "const   x=1;\n";
    await writeFile(file, original);

    const result = await runLsp(
      { operation: "format", path: "a.ts" },
      toolContext(cwd, formatterConfig()),
    );
    const data = result.data as {
      changed: boolean;
      formatter: string;
      diff: { add: number; del: number; hunks: unknown[] };
    };

    expect(result.ok).toBe(true);
    expect(data.changed).toBe(true);
    expect(data.formatter).toBe(process.execPath);
    expect(data.diff.add).toBe(1);
    expect(data.diff.del).toBe(1);
    expect(data.diff.hunks.length).toBeGreaterThan(0);
    expect(result.output).toContain("format a.ts: +1 -1 with");
    expect(result.output).toContain("+const x = 1;");
    expect(await readFile(file, "utf8")).toBe(original);
  });

  test("returns a clear result when no formatter is configured", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const x = 1;\n");
    const lsp: LspConfig = { servers: [], formatters: [] };

    const result = await runLsp({ operation: "format", path: "a.ts" }, toolContext(cwd, lsp));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No formatter configured for .ts files");
  });

  test("never formats a file outside the workspace", async () => {
    const cwd = await tempDir();
    const outside = await tempDir();
    const file = join(outside, "a.ts");
    await writeFile(file, "const   x=1;\n");

    const result = await runLsp(
      { operation: "format", path: file },
      toolContext(cwd, formatterConfig()),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside the workspace");
    expect(await readFile(file, "utf8")).toBe("const   x=1;\n");
  });

  test("only passes allowlisted env vars to the formatter", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const   x=1;\n");

    await withEnv({ FAKE_LSP_SECRET: "top-secret" }, async () => {
      const result = await runLsp(
        { operation: "format", path: "a.ts" },
        toolContext(cwd, formatterConfig()),
      );
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain("top-secret");
    });
  });

  test("times out a slow formatter", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "const   x=1;\n");

    await withEnv({ FAKE_FORMATTER_DELAY_MS: "500" }, async () => {
      const result = await runLsp(
        { operation: "format", path: "a.ts" },
        toolContext(cwd, formatterConfig(["FAKE_FORMATTER_DELAY_MS"], 80)),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain("timed out after 80ms");
    });
  });
});

describe("lsp client lifecycle", () => {
  test("handles multiple requests and clean shutdown", async () => {
    const cwd = await tempDir();
    const marker = join(cwd, "marker.txt");
    const file = join(cwd, "a.ts");
    const text = "const x = 1;\n";
    await writeFile(file, text);

    const client = new LspClient(clientConfig(marker), cwd);
    await client.initialize();
    client.didOpen(pathToFileURL(file).href, "typescript", text);

    const first = await client.request<unknown[]>(
      "textDocument/definition",
      params(pathToFileURL(file).href),
    );
    const second = await client.request<unknown[]>(
      "textDocument/definition",
      params(pathToFileURL(file).href),
    );
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);

    await client.shutdown();
    expect(client.running).toBe(false);
    expect(await readFile(marker, "utf8")).toBe("exit");
  });

  test("cancels a request through an aborted signal and still shuts down", async () => {
    const cwd = await tempDir();
    const file = join(cwd, "a.ts");
    const text = "const x = 1;\n";
    await writeFile(file, text);

    const client = new LspClient(clientConfig(join(cwd, "cancelled-marker.txt")), cwd);
    await client.initialize();
    client.didOpen(pathToFileURL(file).href, "typescript", text);

    const controller = new AbortController();
    controller.abort();
    await expect(
      client.request("textDocument/definition", params(pathToFileURL(file).href), {
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");

    await client.shutdown();
    expect(client.running).toBe(false);
  });

  test("marks a server that exits as not running", async () => {
    const cwd = await tempDir();
    const exiting: LspServerConfig = {
      command: process.execPath,
      args: [fixture],
      env: { FAKE_LSP_EXIT_AFTER_INITIALIZE: "1" },
    };
    const client = new LspClient(exiting, cwd);
    await client.initialize();
    await Bun.sleep(200);

    expect(client.running).toBe(false);
    await expect(client.request("textDocument/definition", {})).rejects.toThrow("Language server");
    await client.shutdown();
  });
});
