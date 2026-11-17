import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sessionModelHistory } from "../../src/app/session-replay";
import { withExternalAccess } from "../../src/core/loop/external-access";
import { ApprovalWaiters } from "../../src/core/session/approvals";
import type { Event } from "../../src/core/types";
import { eventSchema } from "../../src/core/types/event-schema";
import { buildBubblewrapArgs } from "../../src/security/os-sandbox";
import { PermissionEngine } from "../../src/security/permissions";
import { shellPaths } from "../../src/security/shell-paths";
import type { PermissionRequest, PermissionRule } from "../../src/security/types";
import { deleteSession, recordSessionEvent } from "../../src/store/events/index";
import { TerminalManager } from "../../src/terminal/manager";
import { runBashTool } from "../../src/tools/bash/run";
import { runGlob, runGlobFallback } from "../../src/tools/glob/run";
import { runRead } from "../../src/tools/read/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const directories: string[] = [];
const managers: TerminalManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "flecten-harness-contract-")));
  directories.push(cwd);
  const terminals = new TerminalManager({ timeouts: { jobMs: 2000 } });
  managers.push(terminals);
  const context: ToolContext = {
    cwd,
    sessionId: "chat",
    logDir: join(cwd, "logs"),
    signal: new AbortController().signal,
    limits: { readLimitLines: 20, maxOutputBytes: 80, maxOutputLines: 50, bashTimeoutMs: 2000 },
    reads: new ReadTracker(),
    terminals,
    scratchDir: join(cwd, ".flecten-scratch", "chat"),
  };
  return { cwd, context, terminals };
}

test("read advances through a 116386-character line and preserves Unicode across slices", async () => {
  const { cwd, context } = await fixture();
  const text = `${"a".repeat(65533)}😀${"ж".repeat(50851)}`;
  await writeFile(join(cwd, "line.txt"), `${text}\nnext\n`);
  let cursor = { offset: 1, characterOffset: 65530 };
  const first = await runRead({ path: "line.txt", limit: 1 }, context);
  expect(first.ok).toBe(true);
  expect((first.data as { nextCursor: typeof cursor }).nextCursor.characterOffset).toBeGreaterThan(
    0,
  );
  context.limits.maxOutputBytes = 4096;
  const parts: string[] = [];
  while (cursor.offset === 1) {
    const result = await runRead({ path: "line.txt", ...cursor }, context);
    expect(result.ok).toBe(true);
    const data = result.data as { nextCursor: typeof cursor };
    expect(
      data.nextCursor.offset > cursor.offset ||
        data.nextCursor.characterOffset > cursor.characterOffset,
    ).toBe(true);
    const part = result.output.slice(3, result.output.indexOf("\n\n"));
    expect(part).not.toContain("�");
    parts.push(part);
    cursor = data.nextCursor;
  }
  expect(parts.join("")).toBe(text.slice(65530));
  expect((await runRead({ path: "line.txt", offset: 2, limit: 1 }, context)).output).toContain(
    "2: next",
  );
  expect((await runRead({ path: "line.txt", offset: 1, characterOffset: 65534 }, context)).ok).toBe(
    false,
  );
  expect(
    (await runRead({ path: "line.txt", offset: 1, characterOffset: text.length + 1 }, context)).ok,
  ).toBe(false);
  expect(
    (await runRead({ path: "line.txt" }, { ...context, signal: AbortSignal.abort() })).error,
  ).toBe("Read aborted");
});

test("SSH remote payload is opaque while identities, local commands and redirections remain local", () => {
  const command = `ssh -vv -p 2222 -i /keys/id -o UserKnownHostsFile=/keys/hosts user@host 'cd /workspace && python -c '\\''open("/data/frame", "w").write("x")'\\''' > /local/output`;
  expect(shellPaths(command, "/work")).toEqual(
    ["/keys/id", "/keys/hosts", "/local/output"].map((path) => resolve(path)),
  );
  expect(
    shellPaths(`ssh -o 'ProxyCommand=cat /local/proxy' host 'cat /remote/file'`, "/work"),
  ).toEqual([resolve("/local/proxy")]);
  expect(shellPaths(`ssh host "cat $(cat /local/substitution) /remote/file"`, "/work")).toEqual([
    resolve("/local/substitution"),
  ]);
  expect(shellPaths(`ssh -i/keys/id -- host '/remote/thing'`, "/work")).toEqual([
    resolve("/keys/id"),
  ]);
});

test("project overview and recursive file pages expose a real cursor and exclude generated scratch", async () => {
  const { cwd, context } = await fixture();
  for (const name of ["src", "vendor", ".flecten-scratch"]) await mkdir(join(cwd, name));
  await writeFile(join(cwd, "README.md"), "project");
  await writeFile(join(cwd, "src", "main.ts"), "source");
  await writeFile(join(cwd, "vendor", "huge.js"), "generated");
  await writeFile(join(cwd, ".flecten-scratch", "private.txt"), "scratch");
  const overview = await runGlob({ pattern: "*", mode: "entries" }, context);
  expect(overview.output).toContain("src/");
  expect(overview.output).toContain("README.md");
  expect(overview.output).not.toContain("vendor");
  const first = await runGlobFallback({ pattern: "**/*", maxResults: 1 }, context);
  expect(first.data).toMatchObject({ count: 1, total: 2, nextOffset: 1 });
  const second = await runGlobFallback({ pattern: "**/*", maxResults: 1, offset: 1 }, context);
  expect(second.output).toBe("src/main.ts");
  expect(second.data).toMatchObject({ total: 2, nextOffset: null });
  expect(
    (await runGlobFallback({ pattern: "**/*", hidden: true, includeGenerated: true }, context))
      .output,
  ).toContain("vendor/huge.js");
  expect(
    (await runGlobFallback({ pattern: "**/*", hidden: true, includeGenerated: true }, context))
      .output,
  ).not.toContain("private.txt");
});

test("scratch survives foreground and background calls and output verification rejects false success", async () => {
  const { cwd, context, terminals } = await fixture();
  expect(
    (await runBashTool({ command: 'printf corpus > "$FLECTEN_SCRATCH/corpus"' }, context)).ok,
  ).toBe(true);
  expect((await runBashTool({ command: 'cat "$TMPDIR/corpus"' }, context)).output).toBe("corpus");
  expect(
    (
      await runBashTool(
        { command: 'printf job > "$FLECTEN_SCRATCH/job"', background: true },
        context,
      )
    ).ok,
  ).toBe(true);
  await terminals.waitJob("job-1", 2000);
  expect(await readFile(join(context.scratchDir ?? "", "job"), "utf8")).toBe("job");
  expect(
    (await runBashTool({ command: "true", expectedOutputs: [{ path: "missing.tar" }] }, context))
      .ok,
  ).toBe(false);
  const verified = await runBashTool(
    {
      command: "printf archive > archive.tar",
      expectedOutputs: [{ path: "archive.tar", minBytes: 7 }],
    },
    context,
  );
  expect(verified.ok).toBe(true);
  expect(verified.data).toMatchObject({
    verifiedOutputs: [{ path: join(cwd, "archive.tar"), bytes: 7 }],
  });
  const args = buildBubblewrapArgs({
    workspaceRoot: cwd,
    cwd,
    allowNetwork: false,
    temporaryDirectory: context.scratchDir ?? "",
    command: "bash",
    args: ["-lc", "true"],
  });
  expect(args.slice(3, 6)).toEqual(["--bind", context.scratchDir ?? "", "/tmp"]);
});

test("session scratch refuses symlink replacement", async () => {
  const { cwd, context } = await fixture();
  await symlink(cwd, join(cwd, ".flecten-scratch"));
  await expect(runBashTool({ command: "true" }, context)).rejects.toThrow("real directory");
});

test("deleting a chat moves its scratch into recoverable trash", async () => {
  const { cwd, context } = await fixture();
  await recordSessionEvent(cwd, {
    type: "session.started",
    sessionId: "chat",
    provider: "test",
    model: "test",
    prompt: "fixture",
  });
  await mkdir(join(cwd, ".flecten", "sessions", "chat"), { recursive: true });
  expect(
    (await runBashTool({ command: 'printf corpus > "$FLECTEN_SCRATCH/corpus"' }, context)).ok,
  ).toBe(true);
  const deleted = await deleteSession(cwd, "chat");
  expect(await readFile(join(deleted.trash, "scratch", "corpus"), "utf8")).toBe("corpus");
  expect(await Bun.file(join(context.scratchDir ?? "", "corpus")).exists()).toBe(false);
});

test("human session grants survive journal replay, keep the owner, and refresh OS roots", async () => {
  const { cwd, context } = await fixture();
  const external = join(cwd, "external");
  await mkdir(external);
  const rules: PermissionRule[] = [
    { action: "external_path", policy: "ask" },
    { action: "shell", policy: "ask" },
  ];
  const permissions = new PermissionEngine({ rules });
  const events: Event[] = [];
  const waiters = new ApprovalWaiters({
    permissions: () => permissions,
    timeoutMs: () => 2000,
    emit(event) {
      events.push(event);
    },
  });
  const request: PermissionRequest = {
    action: "external_path",
    tool: "read",
    path: external,
    cwd,
    sessionId: "chat",
    safety: "bounded",
  };
  const approval = permissions.decide(request);
  const id = approval.approvalId ?? "";
  const waiting = waiters.gate("chat").wait({ id, request, reason: "external" }, context.signal);
  await waiters.respond(id, "allow_session");
  await waiting;
  const restored = new PermissionEngine({ rules });
  const envelopes = events.map((event, index) => ({
    seq: index + 1,
    ts: new Date().toISOString(),
    schemaVersion: 1,
    sessionId: "chat",
    event: eventSchema.parse(event) as Event,
  }));
  await sessionModelHistory(cwd, "chat", new Map(), { envelopes: async () => envelopes }, restored);
  expect(restored.check(request).policy).toBe("allow");
  expect(restored.externalRoots("other", cwd)).toEqual([]);
  expect(
    withExternalAccess({
      ...context,
      permissions: restored,
      osSandbox: { enabled: true, workspaceRoot: cwd, allowNetwork: false, envAllowlist: [] },
    }).osSandbox?.writablePaths,
  ).toContain(external);
  const grant = events.find((event) => event.type === "approval.resolved");
  expect(grant?.type === "approval.resolved" && grant.sessionGrant).toMatchObject({
    owner: "chat",
    kind: "directory",
    path: external,
  });
  expect(
    restored.restoreSessionGrant(
      grant?.type === "approval.resolved" ? grant.sessionGrant : undefined,
      "other",
    ),
  ).toBe(false);
  restored.replaceRules({ rules: [{ action: "external_path", policy: "deny" }] });
  expect(
    restored.restoreSessionGrant(
      grant?.type === "approval.resolved" ? grant.sessionGrant : undefined,
      "chat",
    ),
  ).toBe(false);
  expect(restored.check(request).policy).toBe("deny");
});
