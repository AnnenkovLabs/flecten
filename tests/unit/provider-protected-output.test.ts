import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderProtection } from "../../src/security/provider-protection";
import {
  PROTECTED_OUTPUT_LIMIT,
  PROTECTED_OUTPUT_TRUNCATED,
} from "../../src/security/provider-secrets/output-buffer";
import { ProcessOutputLog } from "../../src/terminal/output-log";
import type { TerminalSession } from "../../src/terminal/session";
import type { TerminalEvent } from "../../src/terminal/types";
import { runBash } from "../../src/tools/bash/run";
import { streamTerminal } from "../../src/tools/terminal/stream";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { bunCommand } from "../helpers/terminal-fixtures";

const NPM_TOKEN = `npm_${"a".repeat(36)}`;
const SLACK_TOKEN = `xoxb-${"b".repeat(40)}`;
const PEM =
  "-----BEGIN PRIVATE KEY-----\nmultiline-private-key-material\n-----END PRIVATE KEY-----";

async function withWorkspace(
  run: (dir: string, protection: ProviderProtection) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "flecten-protected-output-"));
  const protection = new ProviderProtection({});
  try {
    await run(dir, protection);
  } finally {
    protection.vault.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

function noSecrets(text: string): void {
  for (const secret of [NPM_TOKEN, SLACK_TOKEN, PEM, "multiline-private-key-material"])
    expect(text).not.toContain(secret);
}

describe("protected process output", () => {
  test("holds all bytes until complete pipe data is scanned before disk and callback", async () => {
    await withWorkspace(async (dir, protection) => {
      const published: string[] = [];
      const log = await ProcessOutputLog.open(
        dir,
        [],
        (text) => published.push(text),
        (text) => protection.vault.protect(text),
      );
      await log.write(`ordinary\n${NPM_TOKEN.slice(0, 12)}`);
      await log.write(`stderr ${SLACK_TOKEN.slice(0, 15)}`, "stderr");
      await log.write(`${NPM_TOKEN.slice(12)}\n${PEM.slice(0, 35)}`);
      await log.write(`${SLACK_TOKEN.slice(15)}\n`, "stderr");
      await log.write(`${PEM.slice(35)}\nfinished\n`);
      expect(published).toEqual([]);
      expect(await readFile(log.path, "utf8")).toBe("");
      await log.close();
      const disk = await readFile(log.path, "utf8");
      noSecrets(disk);
      noSecrets(published.join(""));
      expect(disk).toContain("[[secret_");
      expect(disk).toContain("ordinary");
      expect(disk).toContain("finished");
      expect(published.join("")).toBe(disk);
      expect(protection.vault.restore(disk)).toContain(NPM_TOKEN);
      expect(protection.vault.restore(disk)).toContain(SLACK_TOKEN);
      expect(protection.vault.restore(disk)).toContain(PEM);
    });
  });

  test("learns structured values in one pipe before exposing their earlier copies in another", async () => {
    await withWorkspace(async (dir, protection) => {
      const secret = "unknown-opaque-password-value";
      const log = await ProcessOutputLog.open(dir, [], undefined, (text) =>
        protection.vault.protect(text),
      );
      await log.write(`copied ${secret}\n`);
      await log.write(`DATABASE_PASSWORD=${secret}\n`, "stderr");
      await log.close();
      expect(await readFile(log.path, "utf8")).not.toContain(secret);
    });
  });

  test("suppresses overflow completely instead of exposing partial multiline or token values", async () => {
    await withWorkspace(async (dir, protection) => {
      const published: string[] = [];
      const log = await ProcessOutputLog.open(
        dir,
        [],
        (text) => published.push(text),
        (text) => protection.vault.protect(text),
      );
      await log.write("ordinary\n-----BEGIN PRIVATE KEY-----\nprivate-prefix\n");
      await log.write("x".repeat(PROTECTED_OUTPUT_LIMIT));
      await log.write("do-not-publish-after-overflow\n", "stderr");
      expect(published).toEqual([]);
      await log.close();
      expect(await readFile(log.path, "utf8")).toBe(PROTECTED_OUTPUT_TRUNCATED);
      expect(published).toEqual([PROTECTED_OUTPUT_TRUNCATED]);
    });
  });

  test("unprotected logs still publish incrementally", async () => {
    await withWorkspace(async (dir) => {
      const published: string[] = [];
      const log = await ProcessOutputLog.open(dir, [], (text) => published.push(text));
      await log.write("ordinary output\n");
      expect(published.join("")).toBe("ordinary output\n");
      expect(await readFile(log.path, "utf8")).toBe("ordinary output\n");
      await log.close();
    });
  });

  test("runBash passes provider protection into its real process log", async () => {
    await withWorkspace(async (dir, protection) => {
      const published: string[] = [];
      const command = await bunCommand(
        dir,
        `process.stdout.write(${JSON.stringify(NPM_TOKEN.slice(0, 10))}); await Bun.sleep(10); process.stdout.write(${JSON.stringify(`${NPM_TOKEN.slice(10)}\n`)});`,
      );
      const result = await runBash(
        { command },
        {
          cwd: dir,
          signal: new AbortController().signal,
          limits: { bashTimeoutMs: 10_000 },
          logDir: join(dir, "logs"),
          reportOutput: (text) => published.push(text),
          providerProtection: protection,
        },
      );
      expect(result.ok).toBe(true);
      const disk = await readFile(result.fullOutputPath ?? "", "utf8");
      noSecrets(disk);
      noSecrets(published.join(""));
      expect(disk).toContain("[[secret_");
    });
  });

  test("runBash suppresses its truncated result as well as its full log", async () => {
    await withWorkspace(async (dir, protection) => {
      const command = await bunCommand(
        dir,
        `process.stdout.write("x".repeat(${PROTECTED_OUTPUT_LIMIT + 1}));`,
      );
      const result = await runBash(
        { command },
        {
          cwd: dir,
          signal: new AbortController().signal,
          limits: { bashTimeoutMs: 10_000 },
          logDir: join(dir, "logs"),
          providerProtection: protection,
        },
      );
      expect(result.output).toBe(PROTECTED_OUTPUT_TRUNCATED);
      expect(await readFile(result.fullOutputPath ?? "", "utf8")).toBe(PROTECTED_OUTPUT_TRUNCATED);
    });
  });
});

describe("protected PTY subscription output", () => {
  function fixture(protection?: ProviderProtection) {
    let subscriber: ((event: TerminalEvent) => void) | undefined;
    const session = {
      onEvent(listener: (event: TerminalEvent) => void) {
        subscriber = listener;
        return () => {
          subscriber = undefined;
        };
      },
    } as Pick<TerminalSession, "onEvent">;
    const published: string[] = [];
    const context: ToolContext = {
      cwd: "/tmp",
      sessionId: "protected-output",
      logDir: "/tmp",
      signal: new AbortController().signal,
      reads: new ReadTracker(),
      limits: {
        bashTimeoutMs: 1000,
        maxOutputBytes: 1000,
        maxOutputLines: 100,
        readLimitLines: 100,
      },
      reportOutput: (text) => published.push(text),
      ...(protection ? { providerProtection: protection } : {}),
    };
    const finish = streamTerminal(session as TerminalSession, context);
    return {
      published,
      finish,
      send: (data: string) =>
        subscriber?.({ type: "data", data, plainText: data, truncated: false }),
    };
  }

  test("scans joined unknown credentials across PTY chunks before publication", async () => {
    await withWorkspace(async (_dir, protection) => {
      const { published, finish, send } = fixture(protection);
      send(`\u001b[31m${SLACK_TOKEN.slice(0, 12)}\u001b[`);
      send(`31m${SLACK_TOKEN.slice(12)}\u001b[0m\n${PEM.slice(0, 30)}`);
      send(`${PEM.slice(30)}\nfinished\n`);
      expect(published).toEqual([]);
      finish();
      noSecrets(published.join(""));
      expect(published.join("")).toContain("[[secret_");
      expect(published.join("")).toContain("finished");
      send("after-unsubscribe");
      finish();
      expect(published.join("")).not.toContain("after-unsubscribe");
    });
  });

  test("bounds protected PTY output and preserves the unprotected streaming path", async () => {
    await withWorkspace(async (_dir, protection) => {
      const protectedFixture = fixture(protection);
      protectedFixture.send(`partial ${NPM_TOKEN.slice(0, 10)}`);
      protectedFixture.send("x".repeat(PROTECTED_OUTPUT_LIMIT));
      protectedFixture.finish();
      expect(protectedFixture.published).toEqual([PROTECTED_OUTPUT_TRUNCATED]);
      const ordinary = fixture();
      ordinary.send("ordinary output\n");
      expect(ordinary.published.join("")).toBe("ordinary output\n");
      ordinary.finish();
    });
  });
});
