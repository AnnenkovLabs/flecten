import { TerminalJob, type TerminalJobOptions, type TerminalJobSnapshot } from "./jobs";
import { type TerminalSandboxPolicy, TerminalSession } from "./session";
import {
  resolveTerminalSettings,
  type TerminalSettings,
  type TerminalSettingsInput,
} from "./settings";
import type { TerminalStartOptions } from "./types";

export type TerminalManagerEvent =
  | { type: "job.started"; job: TerminalJobSnapshot }
  | {
      type: "job.completed";
      job: TerminalJobSnapshot;
      notify: boolean;
      /** What the finalizer of `startJob` returned, as the job's checkpoint. */
      extra?: Record<string, unknown>;
    };

/** Runs after the job exits and before `job.completed` goes out. */
export type JobFinalizer = (
  job: TerminalJobSnapshot,
) => Promise<Record<string, unknown> | undefined>;

export type TerminalManagerListener = (event: TerminalManagerEvent) => void;

export class TerminalManager {
  settings: TerminalSettings;

  private readonly sessions = new Map<string, TerminalSession>();
  private readonly jobs = new Map<string, TerminalJob>();
  private readonly settled = new Map<string, Promise<void>>();
  private readonly listeners = new Set<TerminalManagerListener>();
  private nextJobId = 1;

  constructor(settings: TerminalSettingsInput = {}) {
    this.settings = resolveTerminalSettings(settings);
  }

  /** New settings apply to terminals and jobs started from now on. */
  configure(input: TerminalSettingsInput): void {
    this.settings = resolveTerminalSettings(input);
  }

  get commandTimeoutMs(): number {
    return this.settings.timeouts.commandMs;
  }

  create(
    id: string,
    options: TerminalStartOptions & { sandbox?: TerminalSandboxPolicy },
  ): TerminalSession {
    if (this.sessions.has(id)) {
      throw new Error(`Terminal session already exists: ${id}`);
    }
    const session = new TerminalSession(id);
    const error = session.start(this.applySettings(options));
    if (error !== null) throw error;
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  startJob(command: string, options: TerminalJobOptions, finalize?: JobFinalizer): TerminalJob {
    const id = `job-${this.nextJobId}`;
    this.nextJobId += 1;
    const job = new TerminalJob(id, command, options, this.settings);
    this.jobs.set(id, job);
    const finished = new Promise<void>((resolve) => {
      job.onFinished((snapshot) => {
        void (async () => {
          const extra = finalize ? await finalize(snapshot).catch(() => undefined) : undefined;
          this.emit({
            type: "job.completed",
            job: snapshot,
            notify: this.settings.notifications,
            ...(extra ? { extra } : {}),
          });
          resolve();
        })();
      });
    });
    this.settled.set(id, finished);
    job.start();
    this.emit({ type: "job.started", job: job.snapshot() });
    return job;
  }

  /** Resolves after the job's finalizer ran and `job.completed` went out. */
  async settledJob(id: string): Promise<void> {
    await this.settled.get(id);
  }

  getJob(id: string): TerminalJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): TerminalJob[] {
    return [...this.jobs.values()];
  }

  async waitJob(id: string, timeoutMs?: number): Promise<TerminalJobSnapshot | null> {
    const job = this.jobs.get(id);
    if (job === undefined) return null;
    const result = await job.wait(timeoutMs);
    return result.job;
  }

  async stopJob(id: string): Promise<TerminalJobSnapshot | null> {
    const job = this.jobs.get(id);
    if (job === undefined) return null;
    return job.stop();
  }

  onEvent(listener: TerminalManagerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.sessions.delete(id);
    await session.dispose();
  }

  list(): TerminalSession[] {
    return [...this.sessions.values()];
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    const jobs = [...this.jobs.values()];
    this.sessions.clear();
    this.jobs.clear();
    await Promise.all([
      ...sessions.map((session) => session.dispose()),
      ...jobs.map((job) => (job.persistent ? Promise.resolve(job.detach()) : job.stop())),
    ]);
  }

  private applySettings(
    options: TerminalStartOptions & { sandbox?: TerminalSandboxPolicy },
  ): TerminalStartOptions & { sandbox?: TerminalSandboxPolicy } {
    const timeouts = this.settings.timeouts;
    return {
      ...options,
      shell: options.shell ?? this.settings.shell,
      scrollback: options.scrollback ?? this.settings.scrollback,
      envAllowlist: options.envAllowlist ?? this.settings.envAllowlist,
      ansi: options.ansi ?? this.settings.ansi,
      limits: options.limits ?? this.settings.limits,
      ...(options.timeoutMs === undefined && timeouts.sessionMs !== null
        ? { timeoutMs: timeouts.sessionMs }
        : {}),
    };
  }

  private emit(event: TerminalManagerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
