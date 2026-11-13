import {
  collectProcessIds,
  countUserProcesses,
  type ProcessUsage,
  processTreeIds,
  processUsage,
} from "./process-tree";
import type { TerminalResourceLimits } from "./settings";
import {
  type WindowsProcessSnapshot,
  windowsProcessSnapshot,
  windowsProcessUsage,
} from "./windows-processes";

const MEMORY_HEADROOM_BYTES = 512 * 1024 * 1024;

export function processLimitAllowance(maxProcesses: number): number {
  return Math.max(maxProcesses * 2, 128) + 64;
}

export function memoryLimitBytes(maxMemoryBytes: number): number {
  return maxMemoryBytes + MEMORY_HEADROOM_BYTES;
}

/** The same kernel backstop is used by foreground commands, jobs and interactive shells. */
export function withResourceLimits(command: string[], limits: TerminalResourceLimits): string[] {
  if (process.platform !== "linux") return command;
  const prlimit = Bun.which("prlimit");
  if (prlimit === null) return command;
  const args = [prlimit];
  if (limits.maxProcesses > 0) {
    // ponytail: RLIMIT_NPROC is per user, the monitor enforces the exact tree budget.
    // Use cgroups or Windows job objects when limits must be isolated by the kernel.
    args.push(`--nproc=${countUserProcesses() + processLimitAllowance(limits.maxProcesses)}`);
  }
  if (limits.maxMemoryBytes > 0) args.push(`--as=${memoryLimitBytes(limits.maxMemoryBytes)}`);
  return args.length === 1 ? command : [...args, "--", ...command];
}

export function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function resourceLimitViolation(
  usage: ProcessUsage,
  limits: TerminalResourceLimits,
): string | null {
  if (limits.maxProcesses > 0 && usage.count > limits.maxProcesses) {
    return `Resource limit exceeded: process count ${usage.count} is above ${limits.maxProcesses}`;
  }
  if (limits.maxMemoryBytes > 0 && usage.memoryBytes > limits.maxMemoryBytes) {
    return `Resource limit exceeded: memory ${formatBytes(usage.memoryBytes)} is above ${formatBytes(limits.maxMemoryBytes)}`;
  }
  if (limits.ports !== null) {
    for (const port of usage.ports) {
      if (port < limits.ports.min || port > limits.ports.max) {
        return `Resource limit exceeded: port ${port} is outside ${limits.ports.min}-${limits.ports.max}`;
      }
    }
  }
  return null;
}

export async function readProcessTreeUsage(
  pid: number,
  isolated: boolean,
  platform: NodeJS.Platform = process.platform,
  readWindows: () => Promise<WindowsProcessSnapshot> = windowsProcessSnapshot,
): Promise<ProcessUsage> {
  if (platform === "win32") {
    const snapshot = await readWindows();
    return windowsProcessUsage(snapshot, processTreeIds(pid, false, snapshot.processes));
  }
  return processUsage(collectProcessIds(pid, isolated));
}

export class ResourceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private generation = 0;

  constructor(
    private readonly target: () => { pid: number | null; isolated: boolean },
    private readonly limits: TerminalResourceLimits,
    private readonly onViolation: (message: string) => void,
    private readonly readUsage = readProcessTreeUsage,
  ) {}

  start(intervalMs: number): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.generation += 1;
  }

  async check(): Promise<void> {
    if (this.checking) return;
    const { pid, isolated } = this.target();
    if (pid === null) return;
    this.checking = true;
    const generation = this.generation;
    try {
      const usage = await this.readUsage(pid, isolated);
      if (generation !== this.generation || this.target().pid !== pid) return;
      const message = resourceLimitViolation(usage, this.limits);
      if (message !== null) this.onViolation(message);
    } catch (error) {
      if (generation !== this.generation || this.target().pid !== pid) return;
      this.onViolation(
        `Resource monitoring failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.checking = false;
    }
  }
}
