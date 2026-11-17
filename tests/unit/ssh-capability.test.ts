import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { permissionAuthority } from "../../src/app/permission-authority";
import { defaultConfig } from "../../src/config/defaults";
import { PermissionsConfigSchema } from "../../src/config/schema";
import { executeCalls } from "../../src/core/loop/tools";
import type { ToolResult } from "../../src/core/types";
import { buildSeatbeltProfile } from "../../src/security/os-sandbox";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import { runJobs } from "../../src/tools/jobs/run";
import { jobsSpec } from "../../src/tools/jobs/schema";
import { prepareSshCapability } from "../../src/tools/jobs/ssh-capability";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { defineTool } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "flecten-ssh-")));
  directories.push(cwd);
  const context: ToolContext = {
    cwd,
    sessionId: "chat",
    logDir: join(cwd, "logs"),
    signal: new AbortController().signal,
    reads: new ReadTracker(),
    limits: { readLimitLines: 10, maxOutputBytes: 10000, maxOutputLines: 100, bashTimeoutMs: 1000 },
    osSandbox: { enabled: true, workspaceRoot: cwd, allowNetwork: true, envAllowlist: ["PATH"] },
  };
  return { cwd, context };
}

test.skipIf(process.platform === "win32")(
  "SSH preflight forwards only the live socket and selected public host keys",
  async () => {
    const { cwd, context } = await fixture();
    const socket = join(cwd, "agent.sock");
    const server = createServer((connection) => connection.end());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    const socketAlias = join(cwd, "agent.link");
    await symlink("agent.sock", socketAlias);
    const add = join(cwd, "ssh-add");
    await writeFile(add, "#!/bin/sh\nexit 0\n");
    await chmod(add, 0o700);
    const known = join(cwd, "known_hosts");
    await writeFile(
      known,
      "fixture ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLIC\nunrelated ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOTHER\n",
    );
    const prepared = await prepareSshCapability({ host: "fixture", port: 22 }, context, {
      agentSocket: socketAlias,
      sshAdd: add,
      knownHostsFile: known,
    });
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.context.env?.SSH_AUTH_SOCK).toBe(socket);
    expect(prepared.context.osSandbox?.envAllowlist).toContain("SSH_AUTH_SOCK");
    expect(prepared.context.osSandbox?.readOnlyPaths).toContain(socket);
    const sandbox = prepared.context.osSandbox;
    if (!sandbox) throw new Error("SSH sandbox policy is missing");
    expect(buildSeatbeltProfile({ ...sandbox, cwd })).toContain(JSON.stringify(socket));
    expect(prepared.arguments).toContain("StrictHostKeyChecking=yes");
    expect(prepared.arguments).toContain("ForwardAgent=no");
    const hosts =
      prepared.arguments
        .find((argument) => argument.startsWith("UserKnownHostsFile="))
        ?.slice("UserKnownHostsFile=".length) ?? "";
    const content = await readFile(hosts, "utf8");
    expect(content).toContain("fixture ssh-ed25519");
    expect(content).not.toContain("unrelated");
    const missingHost = await prepareSshCapability({ host: "unknown", port: 22 }, context, {
      agentSocket: socket,
      sshAdd: add,
      knownHostsFile: known,
    });
    expect(missingHost.ok).toBe(false);
    if (!missingHost.ok) expect(missingHost.data).toMatchObject({ code: "host_key_unavailable" });
    const unavailable = await prepareSshCapability({ host: "fixture", port: 22 }, context, {
      agentSocket: join(cwd, "missing"),
    });
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.data).toMatchObject({ code: "auth_unavailable" });
  },
);

test("session grant authority survives restart and cannot revive after policy changes back", async () => {
  const { cwd } = await fixture();
  const config = defaultConfig();
  config.permissions = { ...PermissionsConfigSchema.parse(config.permissions), shell: "ask" };
  const initial = await permissionAuthority(cwd, config);
  expect((await permissionAuthority(cwd, config)).grantEpoch).toBe(initial.grantEpoch);
  const engine = new PermissionEngine(initial);
  const request = {
    action: "shell" as const,
    tool: "bash",
    cwd,
    sessionId: "chat",
    target: "echo hello",
    args: { command: "echo hello" },
  };
  const pending = engine.decide(request);
  expect(pending.approvalId).toBeDefined();
  engine.approve(pending.approvalId ?? "", "allow_session");
  const grant = engine.sessionGrant(request);
  expect(
    new PermissionEngine(await permissionAuthority(cwd, config)).restoreSessionGrant(grant, "chat"),
  ).toBe(true);
  const permissions = PermissionsConfigSchema.parse(config.permissions);
  await permissionAuthority(cwd, { ...config, permissions: { ...permissions, shell: "deny" } });
  const returned = await permissionAuthority(cwd, config);
  expect(returned.grantEpoch).not.toBe(initial.grantEpoch);
  expect(new PermissionEngine(returned).restoreSessionGrant(grant, "chat")).toBe(false);
});

test.skipIf(process.platform !== "linux" || !Bun.which("python3"))(
  "guarded remote jobs preserve the scoped agent through live security refresh and obey a network revoke",
  async () => {
    const { cwd, context } = await fixture();
    const socket = join(cwd, "agent.sock");
    const server = createServer((connection) => connection.end());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    const add = join(cwd, "ssh-add");
    const ssh = join(cwd, "ssh");
    const hosts = join(cwd, "known_hosts");
    await writeFile(add, "#!/bin/sh\nexit 0\n");
    await writeFile(hosts, "fixture ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLIC\n");
    await writeFile(
      ssh,
      `#!/usr/bin/env python3\nimport os,sys\nassert os.environ.get('SSH_AUTH_SOCK') == ${JSON.stringify(socket)}\nos.environ.pop('FLECTEN_PROCESS_SCOPE',None)\nos.execv('/bin/bash',['bash','-c',sys.argv[-1]])\n`,
    );
    await Promise.all([chmod(add, 0o700), chmod(ssh, 0o700)]);
    let allowNetwork = true;
    context.env = { PATH: `${cwd}:${process.env.PATH}` };
    context.permissions = new PermissionEngine({
      rules: [
        { action: "shell", policy: "allow" },
        { action: "external_path", policy: "deny" },
      ],
    });
    context.security = () => ({
      sandbox: new SandboxPolicy({ workspaceRoot: cwd, allowNetwork }),
      osSandbox: { enabled: false, workspaceRoot: cwd, allowNetwork, envAllowlist: ["PATH"] },
    });
    let forwarded: ToolContext | undefined;
    const tool = defineTool({
      ...jobsSpec,
      execute: (args, current) =>
        runJobs(args, current, async (target, active) => {
          const prepared = await prepareSshCapability(target, active, {
            agentSocket: socket,
            sshAdd: add,
            knownHostsFile: hosts,
          });
          if (prepared.ok) forwarded = prepared.context;
          return prepared;
        }),
    });
    const tools = new ToolRegistry([tool], { limits: context.limits });
    const id = `remote-${crypto.randomUUID()}`;
    const results: ToolResult[] = [];
    await executeCalls(
      [
        {
          id: "submit",
          name: "jobs",
          args: {
            op: "submit",
            id,
            remote: { host: "fixture", cwd },
            argv: ["python3", "-c", "print('ready')"],
          },
        },
      ],
      { tools, toolContext: context, signal: context.signal, parallelTools: false },
      () => {},
      results,
    );
    expect(results[0]?.ok, results[0]?.error).toBe(true);
    expect(forwarded?.security?.().osSandbox?.readOnlyPaths).toContain(socket);
    expect(forwarded?.security?.().osSandbox?.envAllowlist).toContain("SSH_AUTH_SOCK");
    allowNetwork = false;
    expect(forwarded?.security?.().osSandbox?.allowNetwork).toBe(false);
    const revoked: ToolResult[] = [];
    await executeCalls(
      [{ id: "status", name: "jobs", args: { op: "status", id } }],
      { tools, toolContext: context, signal: context.signal, parallelTools: false },
      () => {},
      revoked,
    );
    expect(revoked[0]?.ok).toBe(false);
    expect(revoked[0]?.error).toContain("сеть запрещена");
  },
);
