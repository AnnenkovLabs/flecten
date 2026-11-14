import { expect, test } from "bun:test";
import { killProcessTree } from "../../src/terminal/process-tree";
import {
  ResourceMonitor,
  readProcessTreeUsage,
  resourceLimitViolation,
} from "../../src/terminal/resources";
import { TerminalSession } from "../../src/terminal/session";
import { defaultTerminalShell } from "../../src/terminal/settings";
import { shellArgs, shellCommand, shellCommandArgs } from "../../src/terminal/shell";
import {
  parseWindowsSnapshot,
  windowsProcessSnapshot,
  windowsSnapshotCommand,
} from "../../src/terminal/windows-processes";
import { processAlive } from "../helpers/process-alive";

const mib = 1024 * 1024;
const fixture = JSON.stringify({
  Processes: [
    { ProcessId: 20, ParentProcessId: 1, WorkingSetSize: 10 * mib },
    { ProcessId: 30, ParentProcessId: 20, WorkingSetSize: 20 * mib },
    { ProcessId: 40, ParentProcessId: 30, WorkingSetSize: 30 * mib },
    { ProcessId: 99, ParentProcessId: 1, WorkingSetSize: 200 * mib },
  ],
  Ports: [
    { OwningProcess: 20, LocalPort: 5000 },
    { OwningProcess: 30, LocalPort: 2000 },
    { OwningProcess: 40, LocalPort: 2000 },
    { OwningProcess: 99, LocalPort: 80 },
  ],
});
const limits = { maxProcesses: 4, maxMemoryBytes: 100 * mib, ports: null };

test("Windows monitor selects the CIM path and counts only the root's full PPID tree", async () => {
  let reads = 0;
  const usage = await readProcessTreeUsage(20, true, "win32", async () => {
    reads += 1;
    return parseWindowsSnapshot(fixture);
  });
  expect(reads).toBe(1);
  expect(usage).toEqual({ count: 3, memoryBytes: 60 * mib, ports: [5000, 2000] });
  expect(resourceLimitViolation(usage, limits)).toBeNull();
  expect(resourceLimitViolation(usage, { ...limits, maxProcesses: 2 })).toContain(
    "process count 3",
  );
  expect(resourceLimitViolation(usage, { ...limits, maxMemoryBytes: 50 * mib })).toContain(
    "memory 60 MB",
  );
  expect(resourceLimitViolation(usage, { ...limits, ports: { min: 1024, max: 4000 } })).toContain(
    "port 5000",
  );
});

test("Windows snapshot parsing rejects invalid native values rather than reporting zeros", () => {
  expect(parseWindowsSnapshot('{"Processes":[],"Ports":[]}')).toEqual({
    processes: [],
    ports: [],
  });
  expect(() => parseWindowsSnapshot("bad JSON")).toThrow();
  expect(() => parseWindowsSnapshot('{"Processes":null,"Ports":[]}')).toThrow();
  expect(() =>
    parseWindowsSnapshot(
      JSON.stringify({
        Processes: [{ ProcessId: 2, ParentProcessId: 1, WorkingSetSize: "1024" }],
        Ports: [],
      }),
    ),
  ).toThrow();
  expect(() =>
    parseWindowsSnapshot(
      JSON.stringify({ Processes: [], Ports: [{ OwningProcess: 2, LocalPort: 65536 }] }),
    ),
  ).toThrow();
});

test("Windows query uses the system PowerShell without profiles or shell interpolation", () => {
  const command = windowsSnapshotCommand("C:\\Windows");
  expect(command[0]).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  expect(command.slice(1, -1)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
});

test("native Windows shells use explicit foreground and interactive arguments", () => {
  expect(defaultTerminalShell("win32")).toBe("cmd.exe");
  expect(defaultTerminalShell("linux")).toBe("/bin/bash");
  expect(shellCommandArgs("C:\\Windows\\System32\\cmd.exe", "echo hello")).toEqual([
    "/d",
    "/s",
    "/c",
    '"echo hello"',
  ]);
  expect(shellCommandArgs("powershell.exe", "Write-Output hello")).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Write-Output hello",
  ]);
  expect(shellCommandArgs("/bin/bash", "echo hello")).toEqual(["-lc", "echo hello"]);
  expect(shellArgs("C:\\Windows\\System32\\CMD.EXE")).toEqual(["/d", "/q", "/k"]);
  expect(shellArgs("powershell.exe")).toEqual(["-NoLogo", "-NoProfile", "-NoExit"]);
  const command = '"C:\\Program Files\\Bun\\bun.exe" "C:\\work space\\script.mjs" && echo complete';
  expect(shellCommand("cmd.exe", command)).toEqual({
    cmd: ["cmd.exe", "/d", "/s", "/c", `"${command}"`],
    windowsVerbatimArguments: true,
  });
  expect(shellCommand("powershell.exe", "Write-Output hello").windowsVerbatimArguments).toBe(false);
  expect(shellCommand("/bin/bash", "echo hello").windowsVerbatimArguments).toBe(false);
});

test("resource monitor uses native Windows data and fails closed on query failure", async () => {
  const violations: string[] = [];
  const monitor = new ResourceMonitor(
    () => ({ pid: 20, isolated: false }),
    { ...limits, maxProcesses: 2 },
    (message) => violations.push(message),
    (pid, isolated) =>
      readProcessTreeUsage(pid, isolated, "win32", async () => parseWindowsSnapshot(fixture)),
  );
  await monitor.check();
  expect(violations).toHaveLength(1);
  expect(violations[0]).toContain("process count 3");
  const failed = new ResourceMonitor(
    () => ({ pid: 20, isolated: false }),
    limits,
    (message) => violations.push(message),
    async () => {
      throw new Error("CIM unavailable");
    },
  );
  await failed.check();
  expect(violations[1]).toBe("Resource monitoring failed: CIM unavailable");
});

test("stopping a monitor discards an in-flight native query and prevents overlapping reads", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    count: number;
    memoryBytes: number;
    ports: number[];
  }>();
  const violations: string[] = [];
  let reads = 0;
  const monitor = new ResourceMonitor(
    () => ({ pid: 20, isolated: false }),
    limits,
    (message) => violations.push(message),
    () => {
      reads += 1;
      return promise;
    },
  );
  const first = monitor.check();
  await monitor.check();
  expect(reads).toBe(1);
  monitor.stop();
  resolve({ count: 100, memoryBytes: 0, ports: [] });
  await first;
  expect(violations).toEqual([]);
});

test.skipIf(process.platform !== "win32")(
  "native ConPTY runs, resizes and closes a Windows shell",
  async () => {
    const session = new TerminalSession("windows-pty");
    try {
      expect(session.start({ cwd: process.cwd(), env: { LH_CONPTY_PROBE: "READY" } })).toBeNull();
      expect(session.snapshot().running).toBe(true);
      session.write("echo CONPTY_%LH_CONPTY_PROBE%\r\n");
      const deadline = Date.now() + 5000;
      while (!session.snapshot().plainText.includes("CONPTY_READY") && Date.now() < deadline)
        await Bun.sleep(20);
      expect(session.snapshot().plainText).toContain("CONPTY_READY");
      session.resize(100, 32);
      expect(session.snapshot()).toMatchObject({ cols: 100, rows: 32 });
    } finally {
      await session.dispose();
    }
    expect(session.snapshot().running).toBe(false);
  },
);

test.skipIf(process.platform !== "win32")(
  "native Windows query reports real RSS, owned TCP/UDP ports and taskkill stops descendants",
  async () => {
    const childCode = [
      'import { createServer } from "node:net";',
      'import { createSocket } from "node:dgram";',
      "const server = createServer();",
      'await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));',
      'const udp = createSocket("udp4");',
      'await new Promise(resolve => udp.bind(0, "127.0.0.1", resolve));',
      "console.log(JSON.stringify({ pid: process.pid, tcp: server.address().port, udp: udp.address().port }));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const rootCode = `Bun.spawn([process.execPath, "-e", ${JSON.stringify(childCode)}], { stdout: "inherit", stderr: "inherit" }); setInterval(() => {}, 1000);`;
    const root = Bun.spawn([process.execPath, "-e", rootCode], {
      stdout: "pipe",
      stderr: "inherit",
      timeout: 15000,
    });
    let childPid = 0;
    try {
      const reader = root.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (!output.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Windows process fixture exited before reporting its sockets");
        output += decoder.decode(value, { stream: true });
      }
      const child = JSON.parse(output.slice(0, output.indexOf("\n"))) as {
        pid: number;
        tcp: number;
        udp: number;
      };
      childPid = child.pid;
      reader.releaseLock();
      const usage = await readProcessTreeUsage(root.pid, false);
      expect(usage.count).toBeGreaterThanOrEqual(2);
      expect(usage.memoryBytes).toBeGreaterThan(0);
      expect(usage.ports).toContain(child.tcp);
      expect(usage.ports).toContain(child.udp);
      killProcessTree(root.pid, "SIGKILL", false);
      await root.exited;
      const deadline = Date.now() + 2000;
      while (processAlive(child.pid) && Date.now() < deadline) await Bun.sleep(20);
      expect(processAlive(child.pid)).toBe(false);
      const snapshot = await windowsProcessSnapshot();
      expect(snapshot.processes.some((entry) => entry.pid === child.pid)).toBe(false);
    } finally {
      killProcessTree(root.pid, "SIGKILL", false);
      if (childPid && processAlive(childPid)) process.kill(childPid, "SIGKILL");
    }
  },
  20000,
);
