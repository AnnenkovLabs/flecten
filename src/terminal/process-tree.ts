import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { oneLine } from "../util/text";
import { nativeProcesses, nativeProcessUsage } from "./native-processes";
import { releaseProcessScope, scopeMembers } from "./process-scope";

export interface ProcessStat {
  pid: number;
  ppid: number;
  sid: number;
}

export interface ProcessUsage {
  count: number;
  memoryBytes: number;
  ports: number[];
}

const LISTEN_STATE = "0A";
const PAGE_SIZE = 4096;

export function readProcessStat(pid: number): ProcessStat | null {
  if (process.platform !== "linux")
    return listProcesses().find((entry) => entry.pid === pid) ?? null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const fields = stat.slice(close + 2).split(" ");
    const ppid = Number(fields[1]);
    const sid = Number(fields[3]);
    if (!Number.isFinite(ppid) || !Number.isFinite(sid)) return null;
    return { pid, ppid, sid };
  } catch {
    return null;
  }
}

export function listProcesses(): ProcessStat[] {
  if (process.platform !== "linux") return nativeProcesses();
  try {
    const result: ProcessStat[] = [];
    for (const entry of readdirSync("/proc")) {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const stat = readProcessStat(pid);
      if (stat !== null) result.push(stat);
    }
    return result;
  } catch {
    return [];
  }
}

export function collectProcessIds(rootPid: number, isolated: boolean): number[] {
  const all = listProcesses();
  return processTreeIds(
    rootPid,
    isolated,
    all,
    scopeMembers(
      rootPid,
      all.map((entry) => entry.pid),
    ),
  );
}

export function processTreeIds(
  rootPid: number,
  isolated: boolean,
  all: readonly ProcessStat[],
  scoped: readonly number[] = [],
): number[] {
  const ids = new Set<number>([rootPid, ...scoped]);
  if (isolated) {
    for (const entry of all) {
      if (entry.sid === rootPid) ids.add(entry.pid);
    }
  }
  // A descendant can create its own session with setsid. Its PPID still belongs
  // to this tree, so session membership never replaces the ancestry walk.
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of all) {
      if (!ids.has(entry.pid) && ids.has(entry.ppid)) {
        ids.add(entry.pid);
        changed = true;
      }
    }
  }
  ids.delete(process.pid);
  return [...ids];
}

export function killProcessTree(rootPid: number, signal: NodeJS.Signals, isolated: boolean): void {
  if (process.platform === "win32") {
    Bun.spawnSync(
      ["taskkill", "/PID", String(rootPid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
      { stdout: "ignore", stderr: "ignore", timeout: 2000 },
    );
    if (signal === "SIGKILL") releaseProcessScope(rootPid);
    return;
  }
  const ids = collectProcessIds(rootPid, isolated);
  try {
    process.kill(-rootPid, signal);
  } catch {}
  for (const pid of ids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
  if (signal === "SIGKILL") releaseProcessScope(rootPid);
}

function memoryBytes(pid: number): number {
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, "utf8").split(" ");
    const pages = Number(statm[1]);
    return Number.isFinite(pages) ? pages * PAGE_SIZE : 0;
  } catch {
    return 0;
  }
}

function socketInodes(pids: readonly number[]): Set<string> {
  const inodes = new Set<string>();
  for (const pid of pids) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
          const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
          if (target.startsWith("socket:[") && target.endsWith("]")) {
            inodes.add(target.slice(8, -1));
          }
        } catch {}
      }
    } catch {}
  }
  return inodes;
}

function parseListeningPorts(file: string, inodes: Set<string>, tcp = true): number[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ports: number[] = [];
  const lines = text.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const fields = oneLine(line).split(" ");
    const local = fields[1];
    const state = fields[3];
    const inode = fields[9];
    if (local === undefined || (tcp && state !== LISTEN_STATE) || inode === undefined) continue;
    if (!inodes.has(inode)) continue;
    const separator = local.lastIndexOf(":");
    if (separator < 0) continue;
    const port = Number.parseInt(local.slice(separator + 1), 16);
    if (Number.isInteger(port) && port > 0) ports.push(port);
  }
  return ports;
}

export function processUsage(pids: readonly number[]): ProcessUsage {
  if (process.platform !== "linux") return nativeProcessUsage(pids);
  let memory = 0;
  for (const pid of pids) memory += memoryBytes(pid);
  const inodes = socketInodes(pids);
  return {
    count: pids.length,
    memoryBytes: memory,
    ports: [
      ...parseListeningPorts("/proc/net/tcp", inodes),
      ...parseListeningPorts("/proc/net/tcp6", inodes),
      ...parseListeningPorts("/proc/net/udp", inodes, false),
      ...parseListeningPorts("/proc/net/udp6", inodes, false),
    ],
  };
}

export function countUserProcesses(uid?: number): number {
  const target = uid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
  if (target < 0) return 0;
  let count = 0;
  try {
    for (const entry of readdirSync("/proc")) {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        const status = readFileSync(`/proc/${pid}/status`, "utf8");
        const line = status.split("\n").find((entry) => entry.startsWith("Uid:"));
        if (line === undefined || Number(oneLine(line).split(" ")[1]) !== target) continue;
        // RLIMIT_NPROC counts threads too; /proc lists only group leaders.
        count += readdirSync(`/proc/${pid}/task`).length;
      } catch {}
    }
  } catch {
    return 0;
  }
  return count;
}
