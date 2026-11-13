import type { SessionState } from "../../shared/session-state";
import { createEventBus } from "../core/session/event-bus";
import type { SessionHandle, SessionOptions } from "../core/session/session";
import type { Command, Event, Message, RoutedCommand, SessionId } from "../core/types";
import { EventJournal, type JournalReplay, type StampedEvent } from "./event-journal";

export type StampedListener = (event: StampedEvent) => void;

export interface SessionPoolOptions {
  /** Builds a handle for a session (restoring its queue) or for a new task. */
  create(sessionId: SessionId | undefined): Promise<SessionHandle>;
  /** How many tasks may run at the same time (sessions.maxConcurrent). */
  maxActive(): number;
  /** Refresh live catalogs before a run reads its tool and instruction snapshot. */
  beforeRun?(): Promise<void>;
  secrets?(): readonly string[];
}

export interface SessionActivity {
  sessionId: SessionId;
  running: boolean;
  turns: number;
  queue: number;
  approvals: number;
  jobs: number;
  state?: SessionState | undefined;
}

const MAX_IDLE_HANDLES = 8;

type ApprovalCommand = Extract<
  Command,
  { type: "approval.respond" | "approval.allowAll" | "approval.denyAll" }
>;

function isApproval(command: Command): command is ApprovalCommand {
  return (
    command.type === "approval.respond" ||
    command.type === "approval.allowAll" ||
    command.type === "approval.denyAll"
  );
}

/**
 * One handle per session: each task has its own run, queue, approvals and terminals, so a
 * long task never blocks work in another one. Commands go to the session they name, or to
 * the focused one. Every event gets a sequence number for replay after a window reload.
 */
export class SessionPool implements SessionHandle {
  readonly #options: SessionPoolOptions;
  readonly #handles = new Map<SessionId, SessionHandle>();
  readonly #bus = createEventBus();
  readonly #stamped = new Set<StampedListener>();
  readonly #journal: EventJournal;
  readonly #used = new Map<SessionHandle, number>();
  #fresh: Promise<SessionHandle> | undefined;
  #focused: SessionHandle | undefined;
  #creating: Promise<unknown> = Promise.resolve();

  constructor(options: SessionPoolOptions) {
    this.#options = options;
    this.#journal = new EventJournal(options.secrets);
  }

  /** Listeners get every event of every session, numbered for replay. */
  subscribeStamped(listener: StampedListener): () => void {
    this.#stamped.add(listener);
    return () => this.#stamped.delete(listener);
  }

  subscribe(listener: (event: Event) => void): () => void {
    return this.#bus.subscribe(listener);
  }

  replay(sessionId: SessionId): JournalReplay {
    return this.#journal.replay(sessionId);
  }

  activity(): SessionActivity[] {
    return [...this.#handles.entries()].map(([sessionId, handle]) => {
      const status = handle.peek();
      return { sessionId, ...status };
    });
  }

  async send(command: RoutedCommand): Promise<unknown> {
    if (command.type === "run") return this.#run(command);
    if (command.sessionId === undefined && isApproval(command)) return this.#approve(command);
    const handle = await this.#route(command.sessionId);
    const { sessionId: _sessionId, ...rest } = command;
    const result = await handle.send(rest as Command);
    const sessionId = handle.getSessionId();
    if (sessionId) this.#handles.set(sessionId, handle);
    return result;
  }

  isBusy(): boolean {
    return [...this.#handles.values()].some((handle) => handle.isBusy());
  }

  busy(sessionId: SessionId): boolean {
    return this.#handles.get(sessionId)?.isBusy() ?? false;
  }

  waitsFor(approvalId: string): boolean {
    return this.#owner(approvalId) !== undefined;
  }

  getSessionId(): SessionId | undefined {
    return this.#focused?.getSessionId();
  }

  getHistory(): readonly Message[] {
    return this.#focused?.getHistory() ?? [];
  }

  peek() {
    return this.#focused?.peek() ?? { running: false, turns: 0, queue: 0, approvals: 0, jobs: 0 };
  }

  update(next: Partial<SessionOptions>): void {
    for (const handle of this.#all()) handle.update(next);
  }

  async flush(): Promise<void> {
    await Promise.all(this.#all().map((handle) => handle.flush()));
  }

  /** Closes the handle of a deleted session; the caller makes sure it is not running. */
  async close(sessionId: SessionId): Promise<void> {
    const handle = this.#handles.get(sessionId);
    if (!handle) return;
    this.#handles.delete(sessionId);
    this.#journal.forget(sessionId);
    if (this.#focused === handle) this.#focused = undefined;
    await handle.dispose().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    const handles = this.#all();
    await Promise.all(
      handles.map((handle) => handle.send({ type: "stop" }).catch(() => undefined)),
    );
    await Promise.all(handles.map((handle) => handle.dispose().catch(() => undefined)));
    this.#handles.clear();
  }

  async #run(command: Extract<Command, { type: "run" }>): Promise<unknown> {
    await this.#options.beforeRun?.();
    const requested = command.sessionId;
    const existing = requested === undefined ? undefined : this.#handles.get(requested);
    if (!existing?.isBusy()) {
      const running = [...this.#handles.values()].filter((handle) => handle.isBusy()).length;
      if (running >= this.#options.maxActive()) {
        throw new Error(
          `Одновременно идёт задач: ${running}, это лимит sessions.maxConcurrent. Дождитесь одной или остановите её.`,
        );
      }
    }
    const handle = existing ?? (await this.#handleFor(requested));
    this.#focus(handle);
    return handle.send(command);
  }

  /** An approval answered without a session goes to the task whose call waits for it. */
  async #approve(command: ApprovalCommand): Promise<unknown> {
    if (command.type === "approval.respond") {
      const owner = this.#owner(command.id) ?? (await this.#route(undefined));
      return owner.send(command);
    }
    const groups = new Map<SessionHandle, string[]>();
    for (const id of command.ids) {
      const owner = this.#owner(id) ?? (await this.#route(undefined));
      groups.set(owner, [...(groups.get(owner) ?? []), id]);
    }
    const results = await Promise.all(
      [...groups].map(([handle, ids]) => handle.send({ ...command, ids })),
    );
    return results.flat();
  }

  #owner(approvalId: string): SessionHandle | undefined {
    for (const handle of this.#handles.values()) {
      if (handle.waitsFor(approvalId)) return handle;
    }
    return undefined;
  }

  async #route(sessionId: SessionId | undefined): Promise<SessionHandle> {
    if (sessionId !== undefined) return this.#handleFor(sessionId);
    if (this.#focused) return this.#focused;
    const handle = await this.#freshHandle();
    this.#focus(handle);
    return handle;
  }

  /** The handle of a session; a session without one gets a new handle bound to it. */
  async #handleFor(sessionId: SessionId | undefined): Promise<SessionHandle> {
    if (sessionId === undefined) {
      const handle = await this.#freshHandle();
      this.#fresh = undefined;
      return handle;
    }
    const known = this.#handles.get(sessionId);
    if (known) return known;
    const creating = this.#creating.then(async () => {
      const again = this.#handles.get(sessionId);
      if (again) return again;
      const handle = await this.#build(sessionId);
      this.#handles.set(sessionId, handle);
      return handle;
    });
    this.#creating = creating.catch(() => undefined);
    const handle = await creating;
    this.#evictIdle();
    return handle;
  }

  #freshHandle(): Promise<SessionHandle> {
    this.#fresh ??= this.#build(undefined);
    return this.#fresh;
  }

  async #build(sessionId: SessionId | undefined): Promise<SessionHandle> {
    const handle = await this.#options.create(sessionId);
    handle.subscribe((event) => {
      if (event.type === "session.started" && !this.#handles.has(event.sessionId)) {
        this.#handles.set(event.sessionId, handle);
      }
      const stamped = this.#journal.accept(event);
      for (const item of stamped) {
        this.#bus.emit(item);
        for (const listener of this.#stamped) {
          try {
            listener(item);
          } catch {}
        }
      }
    });
    return handle;
  }

  #focus(handle: SessionHandle): void {
    this.#focused = handle;
    this.#used.set(handle, Date.now());
  }

  #all(): SessionHandle[] {
    const handles = new Set(this.#handles.values());
    if (this.#focused) handles.add(this.#focused);
    return [...handles];
  }

  /** Idle handles without queue, approvals or jobs are closed when there are too many. */
  #evictIdle(): void {
    const idle = [...this.#handles.entries()].filter(([, handle]) => {
      if (handle === this.#focused) return false;
      const status = handle.peek();
      return !status.running && status.queue === 0 && status.approvals === 0 && status.jobs === 0;
    });
    if (idle.length <= MAX_IDLE_HANDLES) return;
    idle.sort(([, left], [, right]) => (this.#used.get(left) ?? 0) - (this.#used.get(right) ?? 0));
    for (const [sessionId, handle] of idle.slice(0, idle.length - MAX_IDLE_HANDLES)) {
      this.#handles.delete(sessionId);
      this.#journal.forget(sessionId);
      void handle.dispose().catch(() => undefined);
    }
  }
}
