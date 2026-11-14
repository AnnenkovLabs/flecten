import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../../src/terminal/manager";
import { runBash } from "../../src/tools/bash/run";
import { bunFileCommand } from "../helpers/shell-command";

test("foreground commands and jobs preserve quoted paths, arguments and shell exit status", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten shell execution-"));
  const script = join(cwd, "file with spaces.mjs");
  const args = ["value with spaces & literal"];
  const manager = new TerminalManager();
  try {
    await writeFile(
      script,
      "console.log(JSON.stringify(process.argv.slice(2))); process.exit(17);",
    );
    const command = `${bunFileCommand(script, args)} && echo must-not-run`;
    const result = await runBash(
      { command },
      { cwd, signal: new AbortController().signal, limits: { bashTimeoutMs: 5000 } },
    );
    expect(result).toMatchObject({ ok: false, data: { exitCode: 17 } });
    expect(result.output).toContain(JSON.stringify(args));
    expect(result.output).not.toContain("must-not-run");

    const finished = await manager.startJob(command, { cwd }).wait(5000);
    expect(finished).toMatchObject({
      timedOut: false,
      job: { status: "failed", exitCode: 17 },
    });
    expect(finished.job.log).toContain(JSON.stringify(args));
    expect(finished.job.log).not.toContain("must-not-run");
  } finally {
    await manager.closeAll();
    await rm(cwd, { recursive: true, force: true });
  }
});
