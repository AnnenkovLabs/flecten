import { oneLine } from "../util/text";
import type { ProcessStat, ProcessUsage } from "./process-tree";
import { windowsProcessSnapshotSync, windowsProcessUsage } from "./windows-processes";

export interface NativeProcess extends ProcessStat {
  memoryBytes: number;
}

export function parseProcessTable(output: string): NativeProcess[] {
  const processes: NativeProcess[] = [];
  for (const line of output.split("\n")) {
    const fields = oneLine(line).split(" ");
    const [pid, ppid, sid, rss] = fields.map(Number);
    if (!pid || ppid === undefined || sid === undefined || rss === undefined) continue;
    if (![pid, ppid, sid, rss].every((value) => Number.isSafeInteger(value) && value >= 0))
      continue;
    processes.push({ pid, ppid, sid, memoryBytes: rss * 1024 });
  }
  return processes;
}

function run(command: string, args: string[]): string {
  try {
    const result = Bun.spawnSync([command, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 1000,
    });
    return result.success ? result.stdout.toString() : "";
  } catch {
    return "";
  }
}

export function nativeProcesses(): NativeProcess[] {
  if (process.platform === "win32") return windowsProcessSnapshotSync().processes;
  return parseProcessTable(
    run(process.platform === "darwin" ? "/bin/ps" : "ps", ["-axo", "pid=,ppid=,pgid=,rss="]),
  );
}

export function parseLsofPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split("\n")) {
    if (!line.startsWith("n")) continue;
    const local = line.slice(1).split("->")[0] ?? "";
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

/** macOS supplies process RSS through ps and socket ownership through lsof. */
export function nativeProcessUsage(pids: readonly number[]): ProcessUsage {
  if (process.platform === "win32") {
    return windowsProcessUsage(windowsProcessSnapshotSync(), pids);
  }
  const selected = new Set(pids);
  const processes = nativeProcesses().filter((entry) => selected.has(entry.pid));
  const selection = pids.join(",");
  const lsof = process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof";
  const common = ["-nP", "-a", "-p", selection, "-Fpn"];
  const tcp = selection ? run(lsof, [...common, "-iTCP", "-sTCP:LISTEN"]) : "";
  const udp = selection ? run(lsof, [...common, "-iUDP"]) : "";
  return {
    count: processes.length,
    memoryBytes: processes.reduce((sum, entry) => sum + entry.memoryBytes, 0),
    ports: [...new Set([...parseLsofPorts(tcp), ...parseLsofPorts(udp)])],
  };
}
