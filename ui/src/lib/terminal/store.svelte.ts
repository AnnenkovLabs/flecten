import type {
  TerminalProfile,
  TerminalStreamEvent,
  TerminalTabInfo,
} from "../../../../shared/terminal";
import { appearance, setTerminalFontSize } from "../appearance.svelte";
import { terminalCommand, terminalSend } from "../ide/terminal";
import { readPreference } from "../preference-storage";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "./xterm-config";

const RAIL_OPEN_KEY = "flecten.terminal.rail-open";

export type TerminalViewportEvent =
  | { type: "data"; data: string; cursor: number }
  | { type: "reset" }
  | { type: "clear" }
  | { type: "exit"; exitCode: number | null; signal: string | null }
  | { type: "error"; message: string };

export type TerminalViewportListener = (event: TerminalViewportEvent) => void;

function readRailOpen(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = readPreference(RAIL_OPEN_KEY, "");
  return raw !== "false";
}

/**
 * Shared workspace terminal state for both IDE dock and Agent Terminal views.
 * Owns live tab metadata, shell profiles, push-stream fan-out, and user/agent PTY controls.
 */
export class TerminalStore {
  tabs = $state<TerminalTabInfo[]>([]);
  profiles = $state<TerminalProfile[]>([]);
  activeId = $state<string | null>(null);
  view = $state<"terminals" | "commands">("terminals");
  railOpen = $state(readRailOpen());

  get fontSize(): number {
    return appearance.terminalFontSize;
  }
  dynamicTitles = $state<Record<string, string>>({});
  unreadIds = $state<Record<string, boolean>>({});
  errors = $state<Record<string, string>>({});
  loading = $state(false);

  #listeners = new Map<string, Set<TerminalViewportListener>>();
  #synced = false;
  #ensuring: Promise<void> | null = null;
  #knownIds = new Set<string>();

  get activeTab(): TerminalTabInfo | null {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? this.tabs[0] ?? null;
  }

  get userTabs(): TerminalTabInfo[] {
    return this.tabs.filter((tab) => tab.owner === "user");
  }

  get agentTabs(): TerminalTabInfo[] {
    return this.tabs.filter((tab) => tab.owner === "agent");
  }

  displayTitle(tab: TerminalTabInfo): string {
    if (tab.owner === "agent" || tab.title !== tab.shellName) {
      return tab.title || tab.shellName || "shell";
    }
    const dynamic = this.dynamicTitles[tab.id]?.trim();
    if (!dynamic) return tab.shellName || "shell";
    // Shells often emit "<cwd> - <shell>" or "<user>@<host>:<cwd>" as OSC 0 title;
    // keep the tab label concise like VS Code while showing full details in tooltips.
    if (
      dynamic.startsWith("/") ||
      dynamic.startsWith("~") ||
      dynamic.includes(":/") ||
      dynamic.includes(":~")
    ) {
      const dash = dynamic.lastIndexOf(" - ");
      if (dash > 0) {
        const tail = dynamic.slice(dash + 3).trim();
        if (tail) return tail;
      }
      return tab.shellName || "shell";
    }
    return dynamic;
  }

  setDynamicTitle(id: string, title: string): void {
    const clean = title.trim();
    if (!clean) return;
    if (this.dynamicTitles[id] === clean) return;
    this.dynamicTitles = { ...this.dynamicTitles, [id]: clean };
  }

  handle(event: TerminalStreamEvent): void {
    switch (event.type) {
      case "terminal.tabs":
        this.#applyTabs(event.tabs, event.profiles);
        return;
      case "terminal.data":
        this.#dispatch(event.id, { type: "data", data: event.data, cursor: event.cursor });
        if (event.id !== this.activeId) {
          this.unreadIds = { ...this.unreadIds, [event.id]: true };
        }
        return;
      case "terminal.exit":
        this.#dispatch(event.id, {
          type: "exit",
          exitCode: event.exitCode,
          signal: event.signal,
        });
        return;
      case "terminal.error":
        this.errors = { ...this.errors, [event.id]: event.message };
        this.#dispatch(event.id, { type: "error", message: event.message });
        return;
    }
  }

  subscribe(id: string, listener: TerminalViewportListener): () => void {
    let set = this.#listeners.get(id);
    if (!set) {
      set = new Set();
      this.#listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.#listeners.delete(id);
    };
  }

  async sync(): Promise<void> {
    this.loading = true;
    try {
      const response = await terminalCommand("list");
      this.#synced = true;
      this.#applyTabs(response.tabs ?? [], response.profiles ?? []);
    } finally {
      this.loading = false;
    }
  }

  async ensureReady(cols = 100, rows = 24): Promise<void> {
    if (this.tabs.length > 0) return;
    if (this.#ensuring) return this.#ensuring;
    this.#ensuring = (async () => {
      if (!this.#synced) await this.sync();
      if (this.tabs.length === 0) {
        await this.create({ cols, rows });
      }
    })().finally(() => {
      this.#ensuring = null;
    });
    return this.#ensuring;
  }

  async create(options: { shell?: string; title?: string; cols?: number; rows?: number } = {}) {
    const response = await terminalCommand("create", options);
    this.#synced = true;
    this.#applyTabs(response.tabs ?? [], response.profiles ?? []);
    if (response.tab) {
      this.select(response.tab.id);
      this.view = "terminals";
    }
    return response.tab ?? null;
  }

  select(id: string): void {
    this.activeId = id;
    this.view = "terminals";
    if (this.unreadIds[id]) {
      const next = { ...this.unreadIds };
      delete next[id];
      this.unreadIds = next;
    }
  }

  write(id: string, data: string): void {
    if (!data) return;
    terminalSend("write", { id, data });
  }

  resize(id: string, cols: number, rows: number): void {
    const safeCols = Math.max(10, Math.min(500, Math.round(cols)));
    const safeRows = Math.max(2, Math.min(200, Math.round(rows)));
    terminalSend("resize", { id, cols: safeCols, rows: safeRows });
  }

  async readReplay(id: string, cursor = 0) {
    return terminalCommand("read", { id, cursor });
  }

  async rename(id: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    const response = await terminalCommand("rename", { id, title: clean });
    if (response.tabs) this.#applyTabs(response.tabs, response.profiles ?? this.profiles);
  }

  async restart(id: string): Promise<void> {
    const nextErrors = { ...this.errors };
    delete nextErrors[id];
    this.errors = nextErrors;
    this.#dispatch(id, { type: "reset" });
    const response = await terminalCommand("restart", { id });
    if (response.tabs) this.#applyTabs(response.tabs, response.profiles ?? this.profiles);
    if (response.data) {
      this.#dispatch(id, { type: "data", data: response.data, cursor: response.cursor });
    }
  }

  async stop(id: string): Promise<void> {
    const response = await terminalCommand("stop", { id });
    if (response.tabs) this.#applyTabs(response.tabs, response.profiles ?? this.profiles);
  }

  async close(id: string): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    const response = await terminalCommand("close", { id });
    const remaining = response.tabs ?? this.tabs.filter((tab) => tab.id !== id);
    this.#applyTabs(remaining, response.profiles ?? this.profiles);
    if (this.activeId === id || !remaining.some((tab) => tab.id === this.activeId)) {
      const fallback = remaining[Math.min(Math.max(0, index), remaining.length - 1)]?.id ?? null;
      this.activeId = fallback;
    }
  }

  clear(id: string): void {
    this.#dispatch(id, { type: "clear" });
  }

  zoom(delta: number): void {
    this.setFontSize(this.fontSize + delta);
  }

  resetZoom(): void {
    this.setFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  }

  setFontSize(value: number): void {
    const next = Math.min(
      MAX_TERMINAL_FONT_SIZE,
      Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)),
    );
    setTerminalFontSize(next);
  }

  toggleRail(): void {
    this.railOpen = !this.railOpen;
    try {
      localStorage.setItem(RAIL_OPEN_KEY, String(this.railOpen));
    } catch {}
  }

  reset(): void {
    this.tabs = [];
    this.profiles = [];
    this.activeId = null;
    this.view = "terminals";
    this.dynamicTitles = {};
    this.unreadIds = {};
    this.errors = {};
    this.#synced = false;
    this.#ensuring = null;
    this.#knownIds.clear();
  }

  #applyTabs(nextTabs: TerminalTabInfo[], nextProfiles: TerminalProfile[]): void {
    const previousKnown = this.#knownIds;
    const nextIds = new Set(nextTabs.map((tab) => tab.id));
    let newlyAddedAgent: TerminalTabInfo | undefined;
    for (const tab of nextTabs) {
      if (!previousKnown.has(tab.id) && tab.owner === "agent") {
        newlyAddedAgent = tab;
      }
    }
    this.#knownIds = nextIds;
    this.tabs = nextTabs;
    if (nextProfiles.length > 0) this.profiles = nextProfiles;
    if (!this.activeId || !nextIds.has(this.activeId)) {
      this.activeId = newlyAddedAgent?.id ?? nextTabs[0]?.id ?? null;
    } else if (newlyAddedAgent && !this.tabs.some((tab) => tab.id === this.activeId)) {
      this.activeId = newlyAddedAgent.id;
    }
  }

  #dispatch(id: string, event: TerminalViewportEvent): void {
    const listeners = this.#listeners.get(id);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(event);
  }
}
