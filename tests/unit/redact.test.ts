import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Event } from "../../src/core/types";
import { DurableEventLog, readTolerant, withEnvelope } from "../../src/store/events/envelope";
import { readSession } from "../../src/store/events/read";
import { sessionPaths } from "../../src/store/paths";
import { redact, redactValue } from "../../src/util/redact";
import { appendEvent } from "../helpers/append-event";

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
const GOOGLE_KEY = `AIza${"A".repeat(35)}`;
const GITHUB_TOKEN = `ghp_${"b".repeat(36)}`;
const GITHUB_PAT = `github_pat_${"c".repeat(30)}`;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2";
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

const SECRETS = { AWS_KEY, GOOGLE_KEY, GITHUB_TOKEN, GITHUB_PAT, JWT };

function expectNoSecrets(text: string): void {
  for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-redact-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("token format redaction", () => {
  test("masks AWS access keys", () => {
    const output = redact(`credentials ${AWS_KEY} end`);
    expectNoSecrets(output);
    expect(output).toContain("AKIA");
    expect(output).toContain("MPLE");
    expect(output).not.toContain("IOSFODNN7EXAM");
  });

  test("masks Google API keys", () => {
    const output = redact(`key=${GOOGLE_KEY}`);
    expectNoSecrets(output);
    expect(output).toContain("AIza");
  });

  test("masks GitHub tokens and fine-grained PATs", () => {
    const output = redact(`${GITHUB_TOKEN} ${GITHUB_PAT}`);
    expectNoSecrets(output);
    expect(output).toContain("ghp_");
    expect(output).toContain("gith");
  });

  test("masks JWTs", () => {
    const output = redact(`session ${JWT} done`);
    expectNoSecrets(output);
    expect(output).toContain("eyJh");
  });

  test("masks PEM private key blocks", () => {
    const output = redact(`before\n${PEM}\nafter`);
    expect(output).not.toContain("MIIEow");
    expect(output).toContain("[redacted:pem]");
    expect(output).toContain("before");
    expect(output).toContain("after");
  });

  test("masks bearer tokens and keeps the scheme", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnopqrst")).toBe(
      "Authorization: Bearer [redacted:abcd…qrst]",
    );
    expect(redact("header Bearer abcdefghijklmnopqrst trailing")).toContain("Bearer [redacted");
  });
});

describe("sensitive key redaction", () => {
  test("masks values by key name without breaking JSON", () => {
    const input = JSON.stringify({
      authorization: "Bearer header-secret-value",
      apiKey: "api-secret-value-123456",
      token: "token-secret-value-123456",
      secret: "generic-secret-value-123",
      password: "correct-horse-battery",
      cookie: "session=cookie-value",
      "set-cookie": "sid=another-cookie-value",
      safe: "visible",
    });
    const output = redact(input);
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.safe).toBe("visible");
    for (const key of [
      "authorization",
      "apiKey",
      "token",
      "secret",
      "password",
      "cookie",
      "set-cookie",
    ]) {
      expect(String(parsed[key])).toContain("[redacted");
      expect(String(parsed[key])).not.toContain("secret-value");
    }
  });

  test("leaves non-secret counters alone", () => {
    const input = JSON.stringify({ max_tokens: 100, token_count: 3, tokens: 5 });
    expect(redact(input)).toBe(input);
    expect(redactValue({ max_tokens: 100, token_count: 3 })).toEqual({
      max_tokens: 100,
      token_count: 3,
    });
    const url = JSON.stringify({ authorization_url: "https://example.test/login" });
    expect(redact(url)).toBe(url);
    expect(redact('{"max_tokens":"100"}')).toBe('{"max_tokens":"100"}');
  });

  test("masks secret-keyed JSON string values such as env maps", () => {
    const output = redact(JSON.stringify({ AWS_SECRET_ACCESS_KEY: "abc1234567890" }));
    expect(output).not.toContain("abc1234567890");
    expect(JSON.parse(output)).toEqual({ AWS_SECRET_ACCESS_KEY: "[redacted]" });
  });

  test("is deterministic and idempotent", () => {
    const once = redact(`key ${AWS_KEY}`);
    expect(redact(`key ${AWS_KEY}`)).toBe(once);
    expect(redact(once)).toBe(once);
  });
});

describe("recursive redaction", () => {
  test("walks nested objects, arrays and JSON strings", () => {
    const input = {
      provider: { apiKey: AWS_KEY, nested: { authorization: `Bearer ${JWT}` } },
      calls: [{ args: { token: GITHUB_TOKEN }, output: `google ${GOOGLE_KEY}` }],
      encoded: JSON.stringify({ secret: JWT, keep: "visible" }),
      safe: "hello",
    };
    const output = redactValue(input);
    const text = JSON.stringify(output);

    expectNoSecrets(text);
    expect(output.safe).toBe("hello");
    expect(output.provider.nested.authorization).toContain("[redacted");
    expect(output.calls[0]?.output).not.toContain(GOOGLE_KEY);

    const encoded = JSON.parse(output.encoded) as Record<string, unknown>;
    expect(encoded.keep).toBe("visible");
    expect(String(encoded.secret)).toContain("[redacted");
  });

  test("preserves JSON validity inside strings", () => {
    const nested = JSON.stringify({ token: JWT, path: "src/index.ts" });
    const output = redactValue(nested) as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.path).toBe("src/index.ts");
    expect(String(parsed.token)).not.toBe(JWT);
    expectNoSecrets(output);
  });

  test("keeps primitive and null values", () => {
    expect(redactValue({ count: 2, ok: true, missing: null, name: "x" })).toEqual({
      count: 2,
      ok: true,
      missing: null,
      name: "x",
    });
  });
});

describe("persistence paths", () => {
  test("redacts before appending JSONL", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      const log = await DurableEventLog.open(path, "s-redact");
      const event: Event = {
        type: "tool.finished",
        sessionId: "s-redact",
        call: { id: "call-1", name: "read", args: { apiKey: AWS_KEY } },
        result: { ok: true, output: `token ${JWT}` },
      };
      await log.append(event);
      await log.close();

      const lines = (await readFile(path, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const raw = lines[0] ?? "";
      expectNoSecrets(raw);
      const parsed = JSON.parse(raw) as { event: Event };
      expect(parsed.event.type).toBe("tool.finished");
      expect(raw).toContain("[redacted");
    });
  });

  test("redacts the legacy append helper", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "events.jsonl");
      await appendEvent(path, {
        type: "session.started",
        sessionId: "s-legacy",
        provider: "test",
        model: "test",
        prompt: `use ${GITHUB_TOKEN}`,
      });
      const raw = await readFile(path, "utf8");
      expectNoSecrets(raw);
      expect(JSON.parse(raw)).toBeObject();
    });
  });

  test("redacts events while reading existing logs and session history", async () => {
    await withTempDir(async (dir) => {
      const id = "s-history";
      const path = sessionPaths(dir, id).events;
      const event: Event = {
        type: "session.started",
        sessionId: id,
        provider: "test",
        model: "test",
        prompt: `key ${AWS_KEY}`,
      };
      await mkdir(dirname(path), { recursive: true });
      await appendFile(
        path,
        `${JSON.stringify(withEnvelope(event, 1, id, "2026-10-25T12:00:00.000Z"))}\n`,
      );

      const { envelopes } = await readTolerant(path);
      expect(noSecret(envelopes)).toBe(true);

      const events = await readSession(dir, id);
      expect(events).toHaveLength(1);
      expect(noSecret(events)).toBe(true);
    });
  });
});

function noSecret(value: unknown): boolean {
  const text = JSON.stringify(value);
  return Object.values(SECRETS).every((secret) => !text.includes(secret));
}
