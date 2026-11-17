import { describe, expect, test } from "bun:test";
import { restoreToolArguments } from "../../src/security/provider-secrets/tool-arguments";
import { SecretVault } from "../../src/security/provider-secrets/vault";

function usingVault(run: (vault: SecretVault) => void): void {
  const vault = new SecretVault();
  try {
    run(vault);
  } finally {
    vault.dispose();
  }
}

describe("provider secret restoration at the tool boundary", () => {
  test.each(["bash", "terminal", "jobs", "web_fetch", "mcp_service_action"])(
    "safe secret bytes can be embedded in %s arguments without changing existing source",
    (name) => {
      usingVault((vault) => {
        const secret = "opaque_credential-123.456/path:one@host%2F+=,end";
        const tag = vault.register(secret);
        const args = {
          command: `printf '%s' '${tag}' && echo "$ORIGINAL"`,
          input: `prefix:${tag}:suffix`,
          nested: [tag],
        };
        const snapshot = structuredClone(args);
        expect(restoreToolArguments(vault, name, args)).toEqual({
          command: `printf '%s' '${secret}' && echo "$ORIGINAL"`,
          input: `prefix:${secret}:suffix`,
          nested: [secret],
        });
        expect(args).toEqual(snapshot);
      });
    },
  );

  test.each([
    ["single quote", "opaque'credential"],
    ["double quote", 'opaque"credential'],
    ["substitution", "opaque$(printf injected)"],
    ["backtick", "opaque`id`"],
    ["newline", "opaque\ncommand"],
    ["carriage return", "opaque\rcommand"],
    ["whitespace", "opaque credential"],
    ["separator", "opaque;command"],
    ["non-ASCII", "opaqueпароль"],
  ])("%s cannot enter command source through secret restoration", (_label, secret) => {
    usingVault((vault) => {
      const tag = vault.register(secret);
      for (const [name, args] of [
        ["bash", { command: `tool --token='${tag}'` }],
        ["terminal", { input: `prefix:${tag}:suffix` }],
        ["terminal", { command: `tool ${tag}` }],
        ["mcp_unknown_execute", { nested: { source: tag } }],
      ] as const) {
        expect(() => restoreToolArguments(vault, name, args)).toThrow(
          "Use an env/file or an encoded representation",
        );
      }
    });
  });

  test.each(["edit", "write", "apply_patch", "read", "glob", "grep"])(
    "%s file data preserves arbitrary secret bytes",
    (name) => {
      usingVault((vault) => {
        const secret = 'multiline "credential"\n$(literal-content)\rпароль';
        const tag = vault.register(secret);
        const args = { content: `before\n${tag}\nafter`, [tag]: "retained", count: 0 };
        const result = restoreToolArguments<Record<string, unknown>>(vault, name, args);
        expect(result.content).toBe(`before\n${secret}\nafter`);
        expect(result[secret]).toBe("retained");
        expect(result.count).toBe(0);
      });
    },
  );

  test.each(["task", "worker", "memory", "context", "todo", "ask", "done"])(
    "%s retains known references for model-facing data",
    (name) => {
      usingVault((vault) => {
        const secret = "sensitive value with shell $syntax";
        const tag = vault.register(secret);
        const args = { prompt: `retain ${tag}`, nested: [{ [tag]: tag }] };
        expect(restoreToolArguments(vault, name, args)).toEqual(args);
        expect(JSON.stringify(restoreToolArguments(vault, name, args))).not.toContain(secret);
      });
    },
  );

  test("encoded representation is usable without decoding into command syntax", () => {
    usingVault((vault) => {
      const secret = "opaque'credential\nwith$syntax";
      const encoded = Buffer.from(secret).toString("base64");
      vault.register(secret);
      const tag = vault.protect(encoded);
      expect(restoreToolArguments(vault, "bash", { command: `tool --encoded=${tag}` })).toEqual({
        command: `tool --encoded=${encoded}`,
      });
    });
  });

  test("unknown and incomplete references fail even in retained model-facing data", () => {
    usingVault((vault) => {
      for (const name of ["write", "bash", "task", "mcp_unknown"]) {
        expect(() => restoreToolArguments(vault, name, { value: "[[secret_unknown]]" })).toThrow(
          "Unknown provider secret tag",
        );
        expect(() => restoreToolArguments(vault, name, { value: "[[secret_incomplete" })).toThrow(
          "incomplete",
        );
      }
    });
  });
});
