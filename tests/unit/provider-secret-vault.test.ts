import { describe, expect, test } from "bun:test";
import { scanSecrets } from "../../src/security/provider-secrets/scanner";
import { SecretVault } from "../../src/security/provider-secrets/vault";
import { redact, redactKnown, redactValue } from "../../src/util/redact";

const TOKEN = "ghp_abcdefghijklmnopqrstuvwx123456789012";
const OPENAI = "sk-proj-abcdefghijklmnop_1234567890";
const JWT = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: "test-user" })).toString("base64url"),
  Buffer.from("signature-1234567890").toString("base64url"),
].join(".");
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIE-sealed-value\n-----END PRIVATE KEY-----";

function usingVault(run: (vault: SecretVault) => void): void {
  const vault = new SecretVault();
  try {
    run(vault);
  } finally {
    vault.dispose();
  }
}

describe("provider secret scanning", () => {
  test.each([
    [
      "dotenv",
      "export SERVICE_API_KEY='opaque-real-credential' # comment",
      "opaque-real-credential",
    ],
    [
      "JSON",
      '{"headers":{"Authorization":"Bearer opaque-json-credential"}}',
      "opaque-json-credential",
    ],
    ["YAML", '  database_password: "correct horse battery staple"', "correct horse battery staple"],
    ["AWS", "credential AKIAIOSFODNN7EXAMPLE done", "AKIAIOSFODNN7EXAMPLE"],
    ["Google", `credential AIza${"A".repeat(35)} done`, `AIza${"A".repeat(35)}`],
    ["GitHub", `credential ${TOKEN} done`, TOKEN],
    ["OpenAI", `credential ${OPENAI} done`, OPENAI],
    ["JWT", `credential ${JWT} done`, JWT],
    ["PEM", `before\n${PEM}\nafter`, PEM],
    [
      "truncated PEM",
      "-----BEGIN RSA PRIVATE KEY-----\nprivate material",
      "-----BEGIN RSA PRIVATE KEY-----\nprivate material",
    ],
    ["Bearer", "send Bearer bearer-opaque-value to service", "bearer-opaque-value"],
    ["Basic", "Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==", "dXNlcjpwYXNzd29yZDEyMw=="],
    [
      "URL credentials",
      "postgres://admin:p4sswordvalue@database.test:5432/project",
      "p4sswordvalue",
    ],
    [
      "URL token",
      "https://service.test/api?access_token=opaque-query-token&count=2",
      "opaque-query-token",
    ],
    ["generic assignment token", `key=${OPENAI}`, OPENAI],
  ])("recognizes %s", (_name, source, secret) => {
    expect(scanSecrets(source)).toContain(secret);
    usingVault((vault) => {
      const protectedValue = vault.protect(source);
      expect(protectedValue).not.toContain(secret);
      expect(vault.restore(protectedValue)).toBe(source);
      expect(vault.protect(protectedValue)).toBe(protectedValue);
    });
  });

  test("published token families and unrelated data", () => {
    const prefixes = [
      "xoxb-",
      "xoxp-",
      "xapp-",
      "npm_",
      "pypi-",
      "glpat-",
      "hf_",
      "lin_api_",
      "sk_live_",
      "rk_test_",
    ];
    for (const prefix of prefixes)
      expect(scanSecrets(prefix + "a".repeat(40))).toContain(prefix + "a".repeat(40));
    const ordinary =
      'count=1234\nmax_tokens=4096\ntoken_count=3\npath=src/index.ts\npassword="x"\nissue ghp_short\nidentifier abcdef1234567890';
    expect(scanSecrets(ordinary)).toEqual([]);
    usingVault((vault) => expect(vault.protect(ordinary)).toBe(ordinary));
  });
});

describe("ephemeral provider secret references", () => {
  test("restores references anywhere in edits and commands", () => {
    usingVault((vault) => {
      const source = "PRIVATE_TOKEN=opaque-edit-secret-123456";
      const tagged = vault.protect(source);
      const tag = tagged.slice("PRIVATE_TOKEN=".length);
      expect(tag).toMatch(/^\[\[secret_[a-f0-9]{64}\]\]$/);
      expect(
        vault.restore({ edit: `before ${tag} after`, command: `tool --token='${tag}'` }),
      ).toEqual({
        edit: "before opaque-edit-secret-123456 after",
        command: "tool --token='opaque-edit-secret-123456'",
      });
      expect(vault.contains({ nested: [tag] })).toBe(true);
      expect(vault.contains({ ordinary: "unchanged" })).toBe(false);
      expect(vault.register("opaque-edit-secret-123456")).toBe(tag);
    });
  });

  test("scans the whole structure first, including sensitive keys and earlier duplicates", () => {
    usingVault((vault) => {
      const secret = "opaque-structured-credential-5231";
      const input = {
        earlier: `copy ${secret}`,
        credentials: { apiKey: secret, nested: [{ authorization: `Bearer ${TOKEN}` }] },
        [secret]: { zero: 0, yes: true, no: null },
      };
      const snapshot = structuredClone(input);
      const protectedValue = vault.protect(input);
      expect(JSON.stringify(protectedValue)).not.toContain(secret);
      expect(JSON.stringify(protectedValue)).not.toContain(TOKEN);
      expect(vault.restore(protectedValue)).toEqual(input);
      expect(input).toEqual(snapshot);
      expect(Object.values(protectedValue).at(-1)).toEqual({ zero: 0, yes: true, no: null });
    });
  });

  test("protects known encoded and JSON-escaped values without changing restoration", () => {
    usingVault((vault) => {
      const secret = 'opaque / "credential" 987654321';
      vault.seed([secret]);
      const variants = [
        secret,
        encodeURIComponent(secret),
        JSON.stringify(secret).slice(1, -1),
        Buffer.from(secret).toString("base64"),
        Buffer.from(secret).toString("base64url"),
        Buffer.from(secret).toString("hex"),
      ];
      const protectedValue = vault.protect(variants);
      for (const [index, original] of variants.entries()) {
        expect(protectedValue[index]).not.toContain(original);
        expect(protectedValue[index]).toStartWith("[[secret_");
      }
      expect(vault.restore(protectedValue)).toEqual(variants);
    });
  });

  test("tags are isolated, unknown references and disposed vaults fail closed", () => {
    const first = new SecretVault();
    const second = new SecretVault();
    try {
      const tag = first.register("same-secret-in-two-sessions");
      expect(second.register("same-secret-in-two-sessions")).not.toBe(tag);
      expect(() => second.restore(tag)).toThrow("Unknown provider secret tag");
      expect(() => first.restore("[[secret_missing]]")).toThrow("Unknown provider secret tag");
      expect(() => first.restore("[[secret_incomplete")).toThrow("incomplete");
      first.dispose();
      expect(first.values).toEqual([]);
      expect(() => first.restore(tag)).toThrow("disposed");
      expect(() => first.register("another value")).toThrow("disposed");
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("overlapping values and short seeded secrets cannot corrupt tags", () => {
    usingVault((vault) => {
      vault.seed(["aaaa", "aaaa-longer-value", "1234"]);
      const input = "aaaa-longer-value aaaa 1234";
      const output = vault.protect(input);
      expect(vault.restore(output)).toBe(input);
      expect(vault.protect(output)).toBe(output);
    });
  });

  test("unrecognized tag-shaped data cannot shelter a known secret", () => {
    usingVault((vault) => {
      const secret = "opaque-tag-shelter-value-5632";
      vault.register(secret);
      for (const source of [`[[secret_${secret}]]`, `[[secret_incomplete ${secret}`]) {
        expect(vault.protect(source)).not.toContain(secret);
      }
    });
  });

  test("registers secrets with all log redaction paths and releases by reference", () => {
    const secret = "opaque-log-boundary-credential-4321";
    const first = new SecretVault();
    const second = new SecretVault();
    try {
      first.register(secret);
      second.register(secret);
      expect(redact(`ordinary ${secret}`)).not.toContain(secret);
      expect(redactKnown({ output: secret }, [])).toEqual({ output: "[redacted]" });
      expect(redactValue<Record<string, string>>({ [secret]: "value" })).toEqual({
        "[redacted]": "value",
      });
      expect(redactValue({ output: Buffer.from(secret).toString("base64") })).toEqual({
        output: "[redacted]",
      });
      first.dispose();
      expect(redact(secret)).toBe("[redacted]");
      second.dispose();
      expect(redact(secret)).toBe(secret);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("does not silently pass cyclic or unrepresentable model data", () => {
    usingVault((vault) => {
      const value: { self?: unknown } = {};
      value.self = value;
      expect(() => vault.protect(value)).toThrow("cycles");
      expect(() => vault.protect(new Date())).toThrow("plain model data");
    });
  });
});
