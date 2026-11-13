import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "liquid-tool-bounds-"));
  directories.push(path);
  return path;
}

async function isolated(code: string, cwd: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn([process.execPath, "-e", code, cwd], {
    env: { ...process.env, PATH: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 4000);
  try {
    const [exit, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exit, error).toBe(0);
    return JSON.parse(output);
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("production grep fallback aborts a pathological pattern without blocking other sessions", async () => {
  const cwd = await fixture();
  await writeFile(join(cwd, "bad.txt"), `${"a".repeat(800)}!`);
  const module = new URL("../../src/tools/grep/run.ts", import.meta.url).href;
  const result = await isolated(
    `
    const { runGrep } = await import(${JSON.stringify(module)});
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const result = await runGrep({ pattern: "(a+)+$" }, {
      cwd: process.argv[1], signal: AbortSignal.timeout(120)
    });
    clearInterval(timer);
    console.log(JSON.stringify({ ok: result.ok, error: result.error, ticks }));
  `,
    cwd,
  );
  expect(result.ok).toBe(false);
  expect(result.error).toBe("Search aborted");
  expect(Number(result.ticks)).toBeGreaterThan(2);
});

test("read keeps a bounded excerpt of a 64 MiB line and still reads the next range", async () => {
  const cwd = await fixture();
  const file = await open(join(cwd, "long.txt"), "w");
  try {
    const chunk = Buffer.alloc(1024 * 1024, "a");
    for (let count = 0; count < 64; count++) await file.write(chunk);
    await file.write("\nnext\n");
  } finally {
    await file.close();
  }
  const module = new URL("../../src/tools/read/run.ts", import.meta.url).href;
  const result = await isolated(
    `
    const { runRead } = await import(${JSON.stringify(module)});
    const context = { cwd: process.argv[1], limits: { readLimitLines: 10, maxOutputBytes: 80 }, reads: { record() { throw new Error("Large file recorded"); } } };
    const baseline = process.memoryUsage().rss;
    const first = await runRead({ path: "long.txt", limit: 1 }, context);
    const next = await runRead({ path: "long.txt", offset: 2, limit: 1 }, context);
    console.log(JSON.stringify({ ok: first.ok && next.ok, output: first.output, next: next.output, growth: process.memoryUsage().rss - baseline }));
  `,
    cwd,
  );
  expect(result.ok).toBe(true);
  expect(String(result.output)).toContain("Long lines clipped");
  expect(String(result.next)).toContain("2: next");
  // Isolated process avoids noise from unrelated concurrent tests. The original
  // implementation grew by >330 MiB for this 80-byte excerpt.
  expect(Number(result.growth)).toBeLessThan(180 * 1024 * 1024);
});
