import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCalls, type ToolExecutionOptions } from "../../src/core/loop/tools";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event, ToolCall, ToolResult } from "../../src/core/types";
import { buildBubblewrapArgs } from "../../src/security/os-sandbox";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import type { ApprovalChoice, PermissionRule } from "../../src/security/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function fixture(choice: ApprovalChoice = "allow_session") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flecten-directory-access-")));
  dirs.push(root);
  const cwd = join(root, "project");
  const external = join(root, "reference");
  await Promise.all([mkdir(cwd), mkdir(external)]);
  await writeFile(join(external, "one.txt"), "reference one");
  await writeFile(join(external, "two.txt"), "reference two");
  const rules: PermissionRule[] = [
    { action: "read", policy: "auto" },
    { action: "write", policy: "auto" },
    { action: "shell", policy: "allow" },
    { action: "external_path", policy: "ask" },
  ];
  const permissions = new PermissionEngine({ rules });
  const events: Event[] = [];
  let onApproval: (event: Extract<Event, { type: "approval.requested" }>) => void = (event) => {
    void approvals.respond(event.approval.id, choice);
  };
  const approvals = new ApprovalWaiters({
    permissions: () => permissions,
    timeoutMs: () => 1000,
    emit: (event) => {
      events.push(event);
      if (event.type === "approval.requested") onApproval(event);
    },
  });
  const context: ToolContext = {
    cwd,
    sessionId: "chat",
    logDir: join(cwd, ".flecten/logs"),
    signal: new AbortController().signal,
    reads: new ReadTracker(),
    limits: { maxOutputBytes: 5000, maxOutputLines: 100, bashTimeoutMs: 1000, readLimitLines: 100 },
    sandbox: new SandboxPolicy({ workspaceRoot: cwd }),
    permissions,
    approvals: approvals.gate("chat"),
  };
  const options: ToolExecutionOptions = {
    tools: new ToolRegistry(builtinTools(), { limits: context.limits }),
    toolContext: context,
    signal: context.signal,
    parallelTools: true,
  };
  return {
    root,
    cwd,
    external,
    context,
    options,
    permissions,
    rules,
    events,
    approvals,
    listen: (listener: typeof onApproval) => {
      onApproval = listener;
    },
    run: async (calls: ToolCall[]) => {
      const results: ToolResult[] = [];
      await executeCalls(calls, options, () => {}, results);
      return results;
    },
  };
}

const read = (path: string, id = "read"): ToolCall => ({ id, name: "read", args: { path } });

describe("external directory authorization", () => {
  test("one chat grant covers sibling reads, search and a native write without a why argument", async () => {
    const f = await fixture();
    expect((await f.run([read(join(f.external, "one.txt"))]))[0]?.ok).toBe(true);
    const results = await f.run([
      read(join(f.external, "two.txt")),
      {
        id: "search",
        name: "grep",
        args: { path: f.external, pattern: "reference", literal: true },
      },
      {
        id: "write",
        name: "write",
        args: { path: join(f.external, "new.txt"), content: "created" },
      },
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    expect(await readFile(join(f.external, "new.txt"), "utf8")).toBe("created");
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(f.permissions.externalRoots("other-chat", f.cwd)).toEqual([]);
  });

  test("a once-only grant stays on its call", async () => {
    const f = await fixture("allow_once");
    await f.run([read(join(f.external, "one.txt"))]);
    await f.run([read(join(f.external, "two.txt"))]);
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(2);
    expect(f.permissions.externalRoots("chat", f.cwd)).toEqual([]);
  });

  test("a project grant persists a directory rule across tools, arguments and chats", async () => {
    const f = await fixture("allow_always");
    await f.run([read(join(f.external, "one.txt"))]);
    expect(
      f.permissions.check({
        action: "external_path",
        tool: "write",
        cwd: f.cwd,
        path: join(f.external, "two.txt"),
        sessionId: "next",
        safety: "bounded",
      }).policy,
    ).toBe("allow");
    expect(f.permissions.externalRoots("next", f.cwd)).toEqual([f.external]);
  });

  test("parallel requests for the same folder share one chat approval", async () => {
    const f = await fixture();
    const results = await f.run([
      read(join(f.external, "one.txt"), "one"),
      read(join(f.external, "two.txt"), "two"),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
  });

  test("protected external files and explicit resource denies never reach an approval", async () => {
    const f = await fixture();
    await writeFile(join(f.external, ".env"), "secret");
    expect((await f.run([read(join(f.external, ".env"))]))[0]?.ok).toBe(false);
    f.permissions.replaceRules({
      rules: [
        ...f.rules,
        { action: "external_path", pathPrefix: join(f.external, "one.txt"), policy: "deny" },
      ],
    });
    expect((await f.run([read(join(f.external, "one.txt"))]))[0]?.ok).toBe(false);
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(0);
  });

  test("a symlink retargeted during approval cannot borrow the original folder grant", async () => {
    const f = await fixture();
    const alias = join(f.cwd, "alias.txt");
    const elsewhere = join(f.root, "unapproved");
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "secret.txt"), "unapproved");
    await symlink(join(f.external, "one.txt"), alias);
    f.listen((event) => {
      void (async () => {
        await rm(alias);
        await symlink(join(elsewhere, "secret.txt"), alias);
        await f.approvals.respond(event.approval.id, "allow_session");
      })();
    });
    expect((await f.run([read(alias)]))[0]?.ok).toBe(false);
  });

  test("shell cwd and parsed external paths reach the same OS mount boundary", async () => {
    const f = await fixture();
    let mounted: string[] = [];
    f.context.osSandbox = {
      enabled: true,
      allowNetwork: false,
      workspaceRoot: f.cwd,
      envAllowlist: [],
    };
    const tools = builtinTools().map((tool) =>
      tool.name !== "bash"
        ? tool
        : {
            ...tool,
            execute: async (_args: unknown, context: ToolContext) => {
              if (!context.osSandbox) throw new Error("Expected native sandbox");
              mounted = buildBubblewrapArgs({
                ...context.osSandbox,
                cwd: f.external,
                command: "bash",
                args: ["-lc", "true"],
              });
              return { ok: true, output: "mounted" };
            },
          },
    );
    f.options.tools = new ToolRegistry(tools, { limits: f.context.limits });
    const result = await f.run([
      {
        id: "shell",
        name: "bash",
        args: { cwd: f.external, command: `cat '${join(f.external, "one.txt")}'` },
      },
    ]);
    expect(result[0]?.ok).toBe(true);
    expect(mounted.join("\n")).toContain(["--bind", f.external, f.external].join("\n"));
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
  });

  test("revoking a saved directory takes effect on the next operation", async () => {
    const f = await fixture("allow_always");
    await f.run([read(join(f.external, "one.txt"))]);
    f.permissions.replaceRules({ rules: f.rules });
    f.listen((event) => {
      void f.approvals.respond(event.approval.id, "deny");
    });
    expect((await f.run([read(join(f.external, "two.txt"))]))[0]?.ok).toBe(false);
    expect(f.permissions.externalRoots("chat", f.cwd)).toEqual([]);
  });
  test("saved folders are persisted independently and inherited by delegated roles", async () => {
    const saved: PermissionRule[] = [];
    const parent = new PermissionEngine({
      rules: [{ action: "external_path", policy: "ask" }],
      onRemember: (rules) => {
        saved.push(...rules);
      },
    });
    const child = new PermissionEngine(
      { rules: [{ action: "external_path", policy: "allow" }] },
      parent,
    );
    for (const path of ["/reference/a", "/reference/b"]) {
      const request = {
        action: "external_path" as const,
        tool: "read",
        cwd: "/project",
        path,
        sessionId: "chat",
        safety: "bounded" as const,
      };
      const id = child.decide(request).approvalId;
      if (!id) throw new Error("Expected folder approval");
      await child.approve(id, "allow_always")?.persistence;
    }
    expect(saved.map((rule) => rule.pathPrefix)).toEqual(["/reference/a", "/reference/b"]);
    expect(parent.externalRoots("chat", "/project")).toEqual(["/reference/a", "/reference/b"]);
    expect(child.externalRoots("chat", "/project")).toEqual(["/reference/a", "/reference/b"]);
    const sibling = new PermissionEngine({ rules: [{ action: "read", policy: "allow" }] }, parent);
    expect(
      sibling.check({
        action: "external_path",
        tool: "read",
        cwd: "/project",
        path: "/reference/a/file",
        sessionId: "chat",
        safety: "bounded",
      }).policy,
    ).toBe("allow");
    expect(sibling.externalRoots("chat", "/project")).toEqual(["/reference/a", "/reference/b"]);
    const restricted = new PermissionEngine(
      { rules: [{ action: "external_path", policy: "deny" }] },
      parent,
    );
    expect(restricted.externalRoots("chat", "/project")).toEqual([]);
    parent.replaceRules({ rules: [{ action: "external_path", policy: "deny" }] });
    expect(child.externalRoots("chat", "/project")).toEqual([]);
  });
  test("replacing a granted folder with a symlink requires access to the new canonical folder", async () => {
    const f = await fixture();
    expect((await f.run([read(join(f.external, "one.txt"))]))[0]?.ok).toBe(true);
    const moved = join(f.root, "moved-reference");
    await rename(f.external, moved);
    await symlink(moved, f.external);
    f.listen((event) => {
      void f.approvals.respond(event.approval.id, "deny");
    });
    expect((await f.run([read(join(f.external, "two.txt"))]))[0]?.ok).toBe(false);
    expect(f.permissions.externalRoots("chat", f.cwd)).toEqual([]);
    expect(f.events.filter((event) => event.type === "approval.requested")).toHaveLength(2);
  });
});
