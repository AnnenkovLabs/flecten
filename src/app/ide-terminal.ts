import {
  type IdeTerminalInput,
  IdeTerminalInputSchema,
  type IdeTerminalResponse,
  type TerminalProfile,
  type TerminalStreamEvent,
  type TerminalTabInfo,
} from "../../shared/terminal";
import { TerminalManager } from "../terminal/manager";
import { detectDefaultUserShell, listShellProfiles } from "../terminal/profiles";
import type { TerminalSession } from "../terminal/session";
import type { TerminalSettingsInput } from "../terminal/settings";
import { shellName } from "../terminal/shell";
import { RedactionStream } from "../util/redaction-stream";
import {
  bindTabSession,
  clearTabTimer,
  detachTabSession,
  flushTabOutput,
  type ManagedTab,
  tabInfo,
  tabReply,
} from "./ide-terminal-tab";

export interface AgentTerminalAttachment {
  sessionId: string;
  role?: "talker" | "worker";
  ptyId: string;
  title?: string;
  session: TerminalSession;
  close: () => Promise<void>;
  secrets?: readonly string[];
}

export type TerminalStreamListener = (event: TerminalStreamEvent) => void;

function agentTabId(sessionId: string, ptyId: string): string {
  return `agent:${sessionId}:${ptyId}`;
}

/**
 * Workspace terminal hub: owns multi-tab native user PTYs and mirrors every active
 * agent PTY tab over a single low-latency push stream.
 */
export class IdeTerminal {
  #manager = new TerminalManager();
  #tabs = new Map<string, ManagedTab>();
  #listeners = new Set<TerminalStreamListener>();
  #nextUserId = 1;

  constructor(
    private cwd: string,
    private settings: () => TerminalSettingsInput,
  ) {}

  subscribe(listener: TerminalStreamListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  profiles(): TerminalProfile[] {
    return listShellProfiles(this.settings().shell);
  }

  tabs(): TerminalTabInfo[] {
    return [...this.#tabs.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((tab) => tabInfo(tab));
  }

  attachAgentLifecycle(
    event:
      | {
          kind: "created";
          sessionId: string;
          role?: "talker" | "worker";
          id: string;
          title?: string;
          session: TerminalSession;
          close: () => Promise<void>;
        }
      | { kind: "closed"; sessionId: string; role?: "talker" | "worker"; id: string },
    secrets?: readonly string[],
  ): void {
    if (event.kind === "created") {
      this.attachAgentSession({
        sessionId: event.sessionId,
        ...(event.role ? { role: event.role } : {}),
        ptyId: event.id,
        ...(event.title ? { title: event.title } : {}),
        session: event.session,
        close: event.close,
        ...(secrets ? { secrets } : {}),
      });
    } else {
      this.detachAgentSession(event.sessionId, event.id);
    }
  }

  attachAgentSession(input: AgentTerminalAttachment): void {
    const id = agentTabId(input.sessionId, input.ptyId);
    const existing = this.#tabs.get(id);
    if (existing) detachTabSession(existing);
    const snapshot = input.session.snapshot();
    const now = Date.now();
    const shell = input.session.shellPath || this.settings().shell || detectDefaultUserShell();
    const redactor = new RedactionStream(input.secrets);
    const initialData = snapshot.output ? redactor.push(snapshot.output) : "";
    const tab: ManagedTab = {
      id,
      ptyId: input.ptyId,
      owner: "agent",
      sessionId: input.sessionId,
      ...(input.role ? { role: input.role } : {}),
      title: input.title?.trim() || (existing?.customTitle ? existing.title : input.ptyId),
      customTitle: Boolean(input.title?.trim()) || Boolean(existing?.customTitle),
      shell,
      cwd: snapshot.cwd,
      cols: snapshot.cols,
      rows: snapshot.rows,
      running: snapshot.running,
      exitCode: snapshot.exitCode,
      signal: snapshot.signal,
      createdAt: existing?.createdAt ?? now,
      lastActivityAt: now,
      buffer: initialData,
      base: 0,
      epoch: existing ? existing.epoch + 1 : 0,
      pending: "",
      flushTimer: null,
      session: input.session,
      unsubscribe: null,
      closeOwner: input.close,
      redactor,
    };
    this.#tabs.set(id, tab);
    bindTabSession(
      tab,
      input.session,
      (event) => this.#emit(event),
      () => this.#emitTabs(),
    );
    this.#emitTabs();
  }

  detachAgentSession(sessionId: string, ptyId: string): void {
    const id = agentTabId(sessionId, ptyId);
    const tab = this.#tabs.get(id);
    if (!tab) return;
    flushTabOutput(tab, (event) => this.#emit(event));
    detachTabSession(tab);
    this.#tabs.delete(id);
    this.#emitTabs();
  }

  async command(input: unknown): Promise<IdeTerminalResponse> {
    const command = IdeTerminalInputSchema.parse(input);
    switch (command.action) {
      case "list":
        return {
          data: "",
          cursor: 0,
          epoch: 0,
          reset: false,
          running: this.#tabs.size > 0,
          tabs: this.tabs(),
          profiles: this.profiles(),
        };
      case "create": {
        const tab = this.#createUserTab(command);
        this.#emitTabs();
        return this.#reply(tab, 0, true);
      }
      case "rename": {
        const tab = this.#resolveTab(command, false);
        const title = command.title?.trim();
        if (tab && title) {
          tab.title = title;
          tab.customTitle = true;
          this.#emitTabs();
        }
        return tab ? this.#reply(tab, command.cursor, false) : this.#emptyReply();
      }
      case "close": {
        const tab = this.#resolveTab(command, false);
        if (!tab) return this.#emptyReply();
        await this.#closeTab(tab);
        return {
          data: "",
          cursor: 0,
          epoch: tab.epoch,
          reset: false,
          running: false,
          tabs: this.tabs(),
          profiles: this.profiles(),
        };
      }
      case "restart": {
        const targetId = command.id ?? "ide";
        const existing = this.#tabs.get(targetId);
        if (existing?.owner === "agent") return this.#reply(existing, command.cursor, true);
        const tab = await this.#restartUserTab(targetId, existing, command);
        this.#emitTabs();
        return this.#reply(tab, 0, true);
      }
      case "stop": {
        const tab = this.#resolveTab(command, false);
        if (!tab) return this.#emptyReply();
        if (tab.owner === "user") {
          await this.#manager.close(tab.ptyId);
          detachTabSession(tab);
          tab.running = false;
          this.#emitTabs();
        } else {
          tab.session?.kill("SIGTERM");
        }
        return this.#reply(tab, command.cursor, false);
      }
      case "write": {
        const tab = this.#resolveTab(command, command.id === undefined);
        if (tab && command.data) {
          tab.lastActivityAt = Date.now();
          tab.session?.write(command.data);
        }
        return tab ? this.#reply(tab, command.cursor, false) : this.#emptyReply();
      }
      case "resize": {
        const tab = this.#resolveTab(command, false);
        if (tab) {
          tab.cols = command.cols;
          tab.rows = command.rows;
          tab.session?.resize(command.cols, command.rows);
        }
        return tab ? this.#reply(tab, command.cursor, false) : this.#emptyReply();
      }
      case "read": {
        const tab = this.#resolveTab(command, command.id === undefined);
        if (!tab) return this.#emptyReply();
        flushTabOutput(tab, (event) => this.#emit(event));
        return this.#reply(tab, command.cursor, true);
      }
    }
  }

  async dispose(): Promise<void> {
    for (const tab of this.#tabs.values()) {
      clearTabTimer(tab);
      tab.unsubscribe?.();
      tab.unsubscribe = null;
    }
    this.#tabs.clear();
    this.#listeners.clear();
    await this.#manager.closeAll();
  }

  #resolveTab(command: IdeTerminalInput, autoCreateLegacy: boolean): ManagedTab | undefined {
    const id = command.id ?? "ide";
    const existing = this.#tabs.get(id);
    if (existing) return existing;
    if (!autoCreateLegacy) return undefined;
    const created = this.#createUserTab({ ...command, id });
    this.#emitTabs();
    return created;
  }

  #createUserTab(command: IdeTerminalInput): ManagedTab {
    const id = command.id ?? `user-${this.#nextUserId++}`;
    const shell = command.shell ?? detectDefaultUserShell(this.settings().shell);
    const cwd = command.cwd ?? this.cwd;
    const now = Date.now();
    const session = this.#startUserPty(id, cwd, shell, command.cols, command.rows);
    const resolvedShell = session.shellPath || shell;
    const tab: ManagedTab = {
      id,
      ptyId: id,
      owner: "user",
      title: command.title?.trim() || shellName(resolvedShell) || "shell",
      customTitle: Boolean(command.title?.trim()),
      shell: resolvedShell,
      cwd,
      cols: command.cols,
      rows: command.rows,
      running: session.snapshot().running,
      exitCode: null,
      signal: null,
      createdAt: now,
      lastActivityAt: now,
      buffer: "",
      base: 0,
      epoch: 0,
      pending: "",
      flushTimer: null,
      session,
      unsubscribe: null,
    };
    this.#tabs.set(id, tab);
    bindTabSession(
      tab,
      session,
      (event) => this.#emit(event),
      () => this.#emitTabs(),
    );
    return tab;
  }

  async #restartUserTab(
    id: string,
    existing: ManagedTab | undefined,
    command: IdeTerminalInput,
  ): Promise<ManagedTab> {
    if (existing) {
      detachTabSession(existing);
      await this.#manager.close(existing.ptyId);
    }
    const shell = command.shell ?? existing?.shell ?? detectDefaultUserShell(this.settings().shell);
    const cwd = command.cwd ?? existing?.cwd ?? this.cwd;
    const cols = existing?.cols ?? command.cols;
    const rows = existing?.rows ?? command.rows;
    const session = this.#startUserPty(id, cwd, shell, cols, rows);
    const resolvedShell = session.shellPath || shell;
    const now = Date.now();
    const tab: ManagedTab = {
      id,
      ptyId: id,
      owner: "user",
      title: existing?.title ?? (command.title?.trim() || shellName(resolvedShell) || "shell"),
      customTitle: existing?.customTitle ?? Boolean(command.title?.trim()),
      shell: resolvedShell,
      cwd,
      cols,
      rows,
      running: session.snapshot().running,
      exitCode: null,
      signal: null,
      createdAt: existing?.createdAt ?? now,
      lastActivityAt: now,
      buffer: "",
      base: 0,
      epoch: existing ? existing.epoch + 1 : 1,
      pending: "",
      flushTimer: null,
      session,
      unsubscribe: null,
    };
    this.#tabs.set(id, tab);
    bindTabSession(
      tab,
      session,
      (event) => this.#emit(event),
      () => this.#emitTabs(),
    );
    return tab;
  }

  #startUserPty(
    id: string,
    cwd: string,
    shell: string,
    cols: number,
    rows: number,
  ): TerminalSession {
    this.#manager.configure(this.settings());
    return this.#manager.create(id, {
      cwd,
      shell,
      cols,
      rows,
      ansi: true,
      interactive: true,
      scrollback: Math.max(5000, this.settings().scrollback ?? 5000),
    });
  }

  async #closeTab(tab: ManagedTab): Promise<void> {
    detachTabSession(tab);
    this.#tabs.delete(tab.id);
    if (tab.owner === "user") await this.#manager.close(tab.ptyId);
    else if (tab.closeOwner) await tab.closeOwner();
    this.#emitTabs();
  }

  #reply(tab: ManagedTab, cursor: number, includeData: boolean): IdeTerminalResponse {
    return tabReply(tab, cursor, includeData, this.tabs(), this.profiles());
  }

  #emptyReply(): IdeTerminalResponse {
    return {
      data: "",
      cursor: 0,
      epoch: 0,
      reset: false,
      running: false,
      tabs: this.tabs(),
      profiles: this.profiles(),
    };
  }

  #emitTabs(): void {
    this.#emit({ type: "terminal.tabs", tabs: this.tabs(), profiles: this.profiles() });
  }

  #emit(event: TerminalStreamEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
