import { win32 } from "node:path";
import { z } from "zod";
import type { NativeProcess } from "./native-processes";
import type { ProcessUsage } from "./process-tree";

const QUERY_TIMEOUT_MS = 5000;
const processId = z.number().int().min(0).max(0xffff_ffff);
const snapshotSchema = z.object({
  Processes: z.array(
    z.object({
      ProcessId: processId.positive(),
      ParentProcessId: processId,
      WorkingSetSize: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  Ports: z.array(
    z.object({
      OwningProcess: processId,
      LocalPort: z.number().int().min(1).max(65535),
    }),
  ),
});

export interface WindowsProcessSnapshot {
  processes: NativeProcess[];
  ports: Array<{ pid: number; port: number }>;
}

// CIM exposes typed numeric fields without parsing localized tasklist/netstat text.
// MSFT_NetTCPConnection State=2 is LISTEN; UDP endpoints have no listen state.
const QUERY = `
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize |
  Where-Object { $_.ProcessId -gt 0 } | ForEach-Object {
    [pscustomobject]@{ ProcessId = [long]$_.ProcessId; ParentProcessId = [long]$_.ParentProcessId; WorkingSetSize = [long]$_.WorkingSetSize }
  })
$ports = @(
  Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Property OwningProcess,LocalPort,State |
    Where-Object { $_.State -eq 2 -and $_.LocalPort -gt 0 } |
    Select-Object OwningProcess,LocalPort
  Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetUDPEndpoint -Property OwningProcess,LocalPort |
    Where-Object { $_.LocalPort -gt 0 } | Select-Object OwningProcess,LocalPort
)
[pscustomobject]@{ Processes = $processes; Ports = $ports } | ConvertTo-Json -Depth 4 -Compress
`;

export function windowsSnapshotCommand(
  systemRoot = process.env.SystemRoot ?? process.env.WINDIR,
): string[] {
  const executable = systemRoot
    ? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  return [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", QUERY];
}

export function parseWindowsSnapshot(output: string): WindowsProcessSnapshot {
  const parsed = snapshotSchema.parse(JSON.parse(output.trim()));
  return {
    processes: parsed.Processes.map((entry) => ({
      pid: entry.ProcessId,
      ppid: entry.ParentProcessId,
      // Windows session IDs identify logon sessions, not POSIX process groups.
      sid: 0,
      memoryBytes: entry.WorkingSetSize,
    })),
    ports: parsed.Ports.map((entry) => ({ pid: entry.OwningProcess, port: entry.LocalPort })),
  };
}

export function windowsProcessUsage(
  snapshot: WindowsProcessSnapshot,
  pids: readonly number[],
): ProcessUsage {
  const selected = new Set(pids);
  const processes = snapshot.processes.filter((entry) => selected.has(entry.pid));
  return {
    count: processes.length,
    memoryBytes: processes.reduce((sum, entry) => sum + entry.memoryBytes, 0),
    ports: [
      ...new Set(
        snapshot.ports.filter((entry) => selected.has(entry.pid)).map((entry) => entry.port),
      ),
    ],
  };
}

export function windowsProcessSnapshotSync(): WindowsProcessSnapshot {
  const result = Bun.spawnSync(windowsSnapshotCommand(), {
    stdout: "pipe",
    stderr: "pipe",
    timeout: QUERY_TIMEOUT_MS,
  });
  if (!result.success) throw new Error(`Windows resource query failed (${result.exitCode})`);
  return parseWindowsSnapshot(result.stdout.toString());
}

let pending: Promise<WindowsProcessSnapshot> | undefined;

/** Concurrent task monitors share one bounded query, without blocking the sidecar. */
export function windowsProcessSnapshot(): Promise<WindowsProcessSnapshot> {
  if (pending) return pending;
  pending = query().finally(() => {
    pending = undefined;
  });
  return pending;
}

async function query(): Promise<WindowsProcessSnapshot> {
  const proc = Bun.spawn({
    cmd: windowsSnapshotCommand(),
    stdout: "pipe",
    stderr: "pipe",
    timeout: QUERY_TIMEOUT_MS,
  });
  const [output, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`Windows resource query failed (${code})`);
  return parseWindowsSnapshot(output);
}
