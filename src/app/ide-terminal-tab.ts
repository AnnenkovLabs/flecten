import type {
  IdeTerminalResponse,
  TerminalOwner,
  TerminalProfile,
  TerminalStreamEvent,
  TerminalTabInfo,
} from "../../shared/terminal";
import type { TerminalSession } from "../terminal/session";
import { shellName } from "../terminal/shell";
import type { RedactionStream } from "../util/redaction-stream";

const MAX_BUFFER_CHARS = 256 * 1024;
const TRIM_TARGET_CHARS = 192 * 1024;
const STREAM_COALESCE_MS = 6;

export interface ManagedTab {
  id: string;
  ptyId: string;
  owner: TerminalOwner;
  sessionId?: string;
  role?: "talker" | "worker";
  title: string;
  customTitle: boolean;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  createdAt: number;
  lastActivityAt: number;
  buffer: string;
  base: number;
  epoch: number;
  pending: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  session: TerminalSession | null;
  unsubscribe: (() => void) | null;
  closeOwner?: () => Promise<void>;
  redactor?: RedactionStream;
}

export function tabInfo(tab: ManagedTab): TerminalTabInfo {
  return {
    id: tab.id,
    ptyId: tab.ptyId,
    owner: tab.owner,
    ...(tab.sessionId ? { sessionId: tab.sessionId } : {}),
    ...(tab.role ? { role: tab.role } : {}),
    title: tab.title,
    shell: tab.shell,
    shellName: shellName(tab.shell) || "shell",
    cwd: tab.cwd,
    cols: tab.cols,
    rows: tab.rows,
    running: tab.session?.snapshot().running ?? tab.running,
    exitCode: tab.exitCode,
    signal: tab.signal,
    createdAt: tab.createdAt,
    lastActivityAt: tab.lastActivityAt,
  };
}

export function appendTabBuffer(tab: ManagedTab, chunk: string): void {
  tab.buffer += chunk;
  if (tab.buffer.length > MAX_BUFFER_CHARS) {
    const dropped = tab.buffer.length - TRIM_TARGET_CHARS;
    tab.buffer = tab.buffer.slice(dropped);
    tab.base += dropped;
  }
}

export function clearTabTimer(tab: ManagedTab): void {
  if (tab.flushTimer !== null) {
    clearTimeout(tab.flushTimer);
    tab.flushTimer = null;
  }
}

export function flushTabOutput(tab: ManagedTab, emit: (event: TerminalStreamEvent) => void): void {
  clearTabTimer(tab);
  if (!tab.pending) return;
  const data = tab.pending;
  tab.pending = "";
  emit({
    type: "terminal.data",
    id: tab.id,
    data,
    cursor: tab.base + tab.buffer.length,
  });
}

export function scheduleTabFlush(
  tab: ManagedTab,
  emit: (event: TerminalStreamEvent) => void,
): void {
  if (tab.flushTimer !== null) return;
  tab.flushTimer = setTimeout(() => {
    tab.flushTimer = null;
    flushTabOutput(tab, emit);
  }, STREAM_COALESCE_MS);
  tab.flushTimer.unref?.();
}

export function detachTabSession(tab: ManagedTab): void {
  clearTabTimer(tab);
  tab.unsubscribe?.();
  tab.unsubscribe = null;
  tab.session = null;
}

export function bindTabSession(
  tab: ManagedTab,
  session: TerminalSession,
  emit: (event: TerminalStreamEvent) => void,
  emitTabs: () => void,
): void {
  tab.unsubscribe = session.onEvent((event) => {
    if (event.type === "data") {
      const chunk = tab.redactor ? tab.redactor.push(event.data) : event.data;
      if (!chunk) return;
      tab.lastActivityAt = Date.now();
      appendTabBuffer(tab, chunk);
      tab.pending += chunk;
      scheduleTabFlush(tab, emit);
      return;
    }
    if (event.type === "exit") {
      if (tab.redactor) {
        const tail = tab.redactor.finish();
        if (tail) {
          appendTabBuffer(tab, tail);
          tab.pending += tail;
        }
      }
      flushTabOutput(tab, emit);
      tab.running = false;
      tab.exitCode = event.exitCode;
      tab.signal = event.signal;
      tab.lastActivityAt = Date.now();
      emit({
        type: "terminal.exit",
        id: tab.id,
        exitCode: event.exitCode,
        signal: event.signal,
      });
      emitTabs();
      return;
    }
    if (event.type === "error") {
      flushTabOutput(tab, emit);
      tab.running = false;
      tab.lastActivityAt = Date.now();
      emit({ type: "terminal.error", id: tab.id, message: event.message });
      emitTabs();
    }
  });
}

export function tabReply(
  tab: ManagedTab,
  cursor: number,
  includeData: boolean,
  tabs: TerminalTabInfo[],
  profiles: TerminalProfile[],
): IdeTerminalResponse {
  const end = tab.base + tab.buffer.length;
  const reset = cursor < tab.base || cursor > end;
  const start = reset ? 0 : cursor - tab.base;
  return {
    data: includeData ? tab.buffer.slice(start) : "",
    cursor: end,
    epoch: tab.epoch,
    reset,
    running: tab.session?.snapshot().running ?? tab.running,
    tab: tabInfo(tab),
    tabs,
    profiles,
  };
}
