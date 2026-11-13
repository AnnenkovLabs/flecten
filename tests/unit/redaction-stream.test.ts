import { describe, expect, test } from "bun:test";
import { RedactionStream } from "../../src/util/redaction-stream";

function chunks(text: string, size: number, known: string[] = []): string {
  const stream = new RedactionStream(known);
  let safe = "";
  for (let index = 0; index < text.length; index += size)
    safe += stream.push(text.slice(index, index + size));
  return safe + stream.finish();
}

describe("streaming redaction", () => {
  test("preserves ordinary text across every chunk boundary", () => {
    const text =
      "Прочитал файл.\nconst value = 42; and a long https://example.com/path\n-----BEGIN CERTIFICATE-----\npublicdata\n-----END CERTIFICATE-----\n";
    for (let size = 1; size < 80; size += 1) expect(chunks(text, size)).toBe(text);
  });

  test("redacts split typed credentials, assignments, quoted values, PEM and known secrets", () => {
    const values = [
      "sk-abcdefghijklmnopqrstuvwxyz",
      "AKIAABCDEFGHIJKLMNOP",
      "AIzaabcdefghijklmnopqrstuvwxyz012345678",
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
      "eyJabcdef.abcdefgh.ijklmnop",
      "arbitrary-known-credential",
    ];
    const text = `${values.join(" ")}\nAuthorization: Bearer opaque-value-1234\napi_key = "some long value"\n-----BEGIN PRIVATE KEY-----\nprivatevalue\n-----END PRIVATE KEY-----\nfinished\n`;
    for (let size = 1; size < 50; size += 1) {
      const safe = chunks(text, size, [values[5] ?? ""]);
      for (const secret of values) expect(safe).not.toContain(secret);
      expect(safe).not.toContain("opaque-value-1234");
      expect(safe).not.toContain("some long value");
      expect(safe).not.toContain("privatevalue");
      expect(safe).toContain("finished");
    }
  });

  test("bounds arbitrarily long words without losing ordinary output or exposing long secrets", () => {
    expect(chunks("x".repeat(100_000), 128)).toBe("x".repeat(100_000));
    expect(chunks(`TOKEN=${"a".repeat(100_000)}\nend`, 128)).not.toContain("a".repeat(100));
    expect(chunks(`Bearer ${"a".repeat(100_000)} end`, 128)).toBe("Bearer [redacted] end");
    const quoted = chunks(`TOKEN="${"a".repeat(100_000)} remaining-secret"\nend`, 128);
    expect(quoted).not.toContain("a".repeat(100));
    expect(quoted).not.toContain("remaining-secret");
    expect(quoted).toContain("end");
  });

  test("masks known credentials containing whitespace before lexical splitting", () => {
    for (let size = 1; size < 20; size += 1) {
      expect(
        chunks("before arbitrary secret across words after", size, [
          "arbitrary secret across words",
        ]),
      ).toBe("before [redacted] after");
    }
  });

  test("masks attached quoted assignments before publishing their first word", () => {
    for (let size = 1; size < 50; size += 1) {
      const safe = chunks(
        "API_KEY=\"first-fragment remaining-fragment\"\npassword='single-secret'\nend",
        size,
      );
      expect(safe).not.toContain("first-fragment");
      expect(safe).not.toContain("remaining-fragment");
      expect(safe).not.toContain("single-secret");
      expect(safe).toContain("end");
    }
  });

  test("waits for the longest known credential when another one is its prefix", () => {
    for (let size = 1; size < 20; size += 1) {
      expect(chunks("before secret-longer after", size, ["secret", "secret-longer"])).toBe(
        "before [redacted] after",
      );
    }
  });

  test("bounds oversized PEM headers and resumes ordinary output after a large private key", () => {
    const stream = new RedactionStream();
    expect(stream.push(`-----BEGIN${" ".repeat(100_000)}`)).toContain("[redacted:pem]");
    expect(
      stream.push("PRIVATE KEY-----\nprivate-value\n-----END PRIVATE KEY-----\nfinished\n") +
        stream.finish(),
    ).toContain("finished");
    const large = chunks(
      `-----BEGIN PRIVATE KEY-----\n${"a".repeat(100_000)}\n-----END PRIVATE KEY-----\nfinished\n`,
      128,
    );
    expect(large).not.toContain("a".repeat(100));
    expect(large).toContain("finished");
  });
});
