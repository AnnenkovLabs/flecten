import { readFileSync } from "node:fs";

export function processAlive(pid: number): boolean {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      return stat.slice(close + 2, close + 3) !== "Z";
    }
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
