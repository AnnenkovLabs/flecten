import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
} from "../../src/security/types";

const dirs: string[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `liquid-security-${label}-`));
  dirs.push(dir);
  return dir;
}

async function workspace(): Promise<{ root: string; outside: string; sandbox: SandboxPolicy }> {
  const base = await tempDir("workspace");
  const root = join(base, "project");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "AGENTS.md"), "rules\n");
  await writeFile(join(outside, "secret.txt"), "secret\n");
  return { root, outside, sandbox: new SandboxPolicy({ workspaceRoot: root }) };
}

function request(
  action: PermissionRequest["action"],
  tool: string,
  path?: string,
): PermissionRequest {
  return path === undefined
    ? { action, tool, cwd: "/workspace" }
    : { action, tool, path, cwd: "/workspace" };
}

function approvalId(decision: PermissionDecision): string {
  if (decision.approvalId === undefined) throw new Error("approval expected");
  return decision.approvalId;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PermissionEngine", () => {
  test("matches exact tool names and normalized path prefixes", () => {
    const rules: PermissionRule[] = [
      { action: "write", tool: "write", pathPrefix: "src", policy: "allow" },
      { action: "write", tool: "write", policy: "ask" },
    ];
    const engine = new PermissionEngine({ rules });

    expect(engine.decide(request("write", "write", "src/main.ts")).policy).toBe("allow");
    expect(engine.decide(request("write", "write", "src2/main.ts")).policy).toBe("ask");
    expect(engine.decide(request("write", "Write", "src/main.ts")).policy).toBe("ask");
    expect(engine.decide(request("write", "write", "../src/main.ts")).policy).toBe("ask");
  });

  test("returns the configured policy with a Russian reason", () => {
    const engine = new PermissionEngine({
      rules: [
        { action: "read", tool: "read", policy: "allow" },
        { action: "network", tool: "fetch", policy: "deny", note: "Сеть выключена" },
        { action: "shell", tool: "bash", policy: "auto" },
      ],
    });

    expect(engine.decide(request("read", "read", "AGENTS.md")).policy).toBe("allow");
    const denied = engine.decide(request("network", "fetch"));
    expect(denied.policy).toBe("deny");
    expect(denied.reason).toContain("запрещено");
    expect(denied.reason).toContain("Сеть выключена");
    const auto = engine.decide(request("shell", "bash"));
    expect(auto.policy).toBe("ask");
    expect(auto.reason).toContain("независимой проверки");
    expect(auto.review).toBe(true);
  });

  test("asks by default and resolves an approval", () => {
    const engine = new PermissionEngine();
    const decision = engine.decide(request("shell", "bash"));

    expect(decision.policy).toBe("ask");
    expect(decision.reason).toContain("подтверждение");
    expect(engine.pending()).toHaveLength(1);

    const id = approvalId(decision);
    expect(engine.approve(id, "allow_once")?.choice).toBe("allow_once");
    expect(engine.pending()).toHaveLength(0);
    expect(engine.consumeDecision(id)?.choice).toBe("allow_once");
    expect(engine.consumeDecision(id)).toBeUndefined();
    expect(engine.approve(id, "allow_once")).toBeUndefined();
  });

  test("keeps allow once temporary and stores allow always as a rule", () => {
    const engine = new PermissionEngine({
      rules: [{ action: "write", tool: "write", policy: "ask" }],
    });

    const first = engine.decide(request("write", "write", "src/main.ts"));
    engine.approve(approvalId(first), "allow_once");
    const second = engine.decide(request("write", "write", "src/main.ts"));
    expect(second.policy).toBe("ask");

    engine.approve(approvalId(second), "allow_always");
    const third = engine.decide(request("write", "write", "src/main.ts"));
    expect(third.policy).toBe("allow");
    expect(third.reason).toContain("разрешено правилом");
    expect(third.reason).toContain("Разрешено пользователем");
    expect(engine.decide(request("write", "write", "src/other.ts")).policy).toBe("ask");
  });

  test("denies all pending approvals", () => {
    const engine = new PermissionEngine();
    const first = engine.decide(request("shell", "bash"));
    const second = engine.decide(request("shell", "bash"));

    const denied = engine.denyAll();
    expect(denied).toHaveLength(2);
    expect(engine.pending()).toHaveLength(0);
    expect(engine.consumeDecision(approvalId(first))?.choice).toBe("deny");
    expect(engine.consumeDecision(approvalId(second))?.choice).toBe("deny");
  });

  test("allows all pending approvals", () => {
    const engine = new PermissionEngine();
    const first = engine.decide(request("shell", "bash"));
    const second = engine.decide(request("shell", "bash"));

    const allowed = engine.approveAll();
    expect(allowed).toHaveLength(2);
    expect(engine.pending()).toHaveLength(0);
    expect(engine.consumeDecision(approvalId(first))?.choice).toBe("allow_once");
    expect(engine.consumeDecision(approvalId(second))?.choice).toBe("allow_once");
  });

  test("expires stale approvals and marks old decisions stale", () => {
    let now = 1_000;
    const engine = new PermissionEngine({
      rules: [{ action: "write", tool: "write", policy: "ask" }],
      now: () => now,
    });

    const expiredDecision = engine.decide(request("write", "write", "src/main.ts"));
    now = 2_000;
    const expired = engine.expireOlderThan(500);
    expect(expired).toHaveLength(1);
    expect(engine.pending()).toHaveLength(0);

    const expiredRecord = engine.consumeDecision(approvalId(expiredDecision));
    expect(expiredRecord?.choice).toBe("deny");
    expect(expiredRecord?.stale).toBe(true);

    const approved = engine.decide(request("write", "write", "src/main.ts"));
    engine.approve(approvalId(approved), "allow_once");
    now = 3_000;
    engine.expireOlderThan(1_000);

    const approvedRecord = engine.consumeDecision(approvalId(approved));
    expect(approvedRecord?.choice).toBe("allow_once");
    expect(approvedRecord?.stale).toBe(true);
  });
});

describe("SandboxPolicy", () => {
  test("denies path traversal outside the workspace", async () => {
    const { sandbox } = await workspace();
    const decision = await sandbox.checkRead("../outside/secret.txt");
    const write = await sandbox.checkWrite("../outside/secret.txt");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("вне рабочей папки");
    expect(write.allowed).toBe(false);
  });

  test("rejects symlinks that escape the workspace", async () => {
    const { root, outside, sandbox } = await workspace();
    await symlink(outside, join(root, "escape"), "dir");
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));

    const directory = await sandbox.checkRead("escape/secret.txt");
    expect(directory.allowed).toBe(false);
    expect(directory.reason).toContain("вне рабочей папки");

    const file = await sandbox.checkRead("leak.txt");
    expect(file.allowed).toBe(false);
    expect(file.reason).toContain("символическая ссылка");
  });

  test("protects config, instructions and secrets", async () => {
    const { sandbox } = await workspace();

    expect((await sandbox.checkWrite(".git/config")).allowed).toBe(false);
    expect((await sandbox.checkWrite("AGENTS.md")).allowed).toBe(false);
    expect((await sandbox.checkWrite("flecten.config.json")).allowed).toBe(false);
    expect((await sandbox.checkWrite(".liquid/sessions/run/events.jsonl")).allowed).toBe(false);
    expect((await sandbox.checkRead(".liquid/secrets.json")).allowed).toBe(false);
    expect((await sandbox.checkRead(".env")).allowed).toBe(false);
    expect((await sandbox.checkRead(join(homedir(), ".ssh", "id_rsa"))).allowed).toBe(false);
    expect((await sandbox.checkRead(join(homedir(), ".aws", "credentials"))).allowed).toBe(false);
  });

  test("separates read and write protection", async () => {
    const { sandbox } = await workspace();

    expect((await sandbox.checkRead(".git/config")).allowed).toBe(true);
    expect((await sandbox.checkWrite(".git/config")).allowed).toBe(false);
    expect((await sandbox.checkWrite("src/main.ts")).allowed).toBe(true);
  });

  test("checks shell commands and network access", async () => {
    const { root, sandbox } = await workspace();

    expect(sandbox.checkShell("ls src").allowed).toBe(true);
    expect(sandbox.checkShell("sudo ls").allowed).toBe(false);
    expect(sandbox.checkShell("cat /etc/passwd").allowed).toBe(false);
    expect(sandbox.checkShell("curl https://example.com").allowed).toBe(false);
    expect(sandbox.checkNetwork("example.com").allowed).toBe(false);

    const online = new SandboxPolicy({
      workspaceRoot: root,
      allowNetwork: true,
      envAllowlist: ["PATH"],
    });
    expect(online.checkShell("curl https://example.com").allowed).toBe(true);
    expect(online.checkNetwork("example.com").allowed).toBe(true);
    expect(online.envAllowlist).toEqual(["PATH"]);
  });

  test("does not use regular expressions", async () => {
    const files = ["types.ts", "permissions.ts", "sandbox.ts"];
    const sources = await Promise.all(
      files.map((file) =>
        readFile(join(import.meta.dir, "..", "..", "src", "security", file), "utf8"),
      ),
    );
    for (const source of sources) {
      expect(source).not.toContain("RegExp");
      expect(source).not.toContain(".match(");
      expect(source).not.toContain(".replace(/");
      expect(source).not.toContain(".split(/");
      expect(source).not.toContain(".test(");
    }
  });
});
