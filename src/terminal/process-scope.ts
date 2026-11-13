import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const scopes = new Map<number, string>();
const KEY = "FLECTEN_PROCESS_SCOPE";

/** Explicit inherited identity survives setsid and a parent exiting before our next poll. */
export function createProcessScope() {
  const token = randomUUID();
  return {
    environment: { [KEY]: token },
    attach(pid: number): void {
      scopes.set(pid, token);
    },
  };
}

export function scopeMembers(rootPid: number, pids: readonly number[]): number[] {
  const token = scopes.get(rootPid);
  if (!token || process.platform !== "linux") return [];
  const members: number[] = [];
  for (const pid of pids) {
    try {
      const variables = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (variables.includes(`${KEY}=${token}`)) members.push(pid);
    } catch {
      // A process can exit or change credentials between enumeration and reading.
    }
  }
  return members;
}

export function releaseProcessScope(rootPid: number): void {
  scopes.delete(rootPid);
}
