import { t } from "./i18n.svelte";
import type { AgentCommand, AgentEvent } from "./types";

export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdaterStatus {
  state: UpdaterState;
  enabled: boolean;
  version?: string;
  percent?: number;
  message?: string;
}

export interface PickedFile {
  path: string;
  name: string;
  size: number;
  kind: string;
}

export interface DesktopBridge {
  setLocale?: (locale: string) => void;
  control(action: "minimize" | "maximize" | "close"): void;
  chooseProject?: () => Promise<string | null>;
  pickAttachments?: () => Promise<PickedFile[]>;
  pasteImage?: () => Promise<PickedFile | null>;
  describePaths?: (paths: string[]) => Promise<PickedFile[]>;
  pathForFile?: (file: File) => string;
  findInPage?: (text: string) => Promise<number>;
  openExternal?: (url: string) => Promise<void>;
  agent?: {
    send(command: AgentCommand): void;
    onEvent(listener: (event: AgentEvent) => void): () => void;
  };
  updater?: {
    state(): Promise<UpdaterStatus>;
    check(): Promise<UpdaterStatus>;
    download(): Promise<UpdaterStatus>;
    install(): Promise<UpdaterStatus>;
    onStatus(listener: (status: UpdaterStatus) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestCommand = DistributiveOmit<Extract<AgentCommand, { requestId: string }>, "requestId">;

export function controlWindow(action: "minimize" | "maximize" | "close"): void {
  window.desktop?.control(action);
}

export async function chooseProject(): Promise<string | null> {
  return (await window.desktop?.chooseProject?.()) ?? null;
}

/** Explicit OAuth/elicitation consent is the only caller. The shell validates http(s). */
export async function openExternal(url: string): Promise<void> {
  if (!window.desktop?.openExternal)
    throw new Error(t("Opening a browser is available in the desktop app"));
  await window.desktop.openExternal(url);
}

export async function pickAttachments(): Promise<PickedFile[]> {
  return (await window.desktop?.pickAttachments?.()) ?? [];
}

export async function pasteImage(): Promise<PickedFile | null> {
  return (await window.desktop?.pasteImage?.()) ?? null;
}

/** Highlights matches in the thread with Chromium find-in-page. Returns null outside Electron. */
export async function findInThread(text: string): Promise<number | null> {
  const find = window.desktop?.findInPage;
  return find ? find(text) : null;
}

/** Real paths for dropped or pasted files. Electron 32+ removed File.path, so the bridge asks webUtils. */
export async function describeDroppedFiles(files: readonly File[]): Promise<{
  accepted: PickedFile[];
  missing: number;
}> {
  const bridge = window.desktop;
  const paths = files.map((file) => bridge?.pathForFile?.(file) ?? "").filter(Boolean);
  const accepted = paths.length > 0 ? ((await bridge?.describePaths?.(paths)) ?? []) : [];
  return { accepted, missing: files.length - accepted.length };
}

export function sendAgent(command: AgentCommand): boolean {
  const bridge = window.desktop?.agent;
  if (!bridge) return false;
  bridge.send(command);
  return true;
}

export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  const unsubscribe = window.desktop?.agent?.onEvent(listener);
  return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
}

export async function getUpdaterState(): Promise<UpdaterStatus | null> {
  return (await window.desktop?.updater?.state()) ?? null;
}

export async function checkUpdate(): Promise<UpdaterStatus | null> {
  return (await window.desktop?.updater?.check()) ?? null;
}

export async function downloadUpdate(): Promise<UpdaterStatus | null> {
  return (await window.desktop?.updater?.download()) ?? null;
}

export async function installUpdate(): Promise<UpdaterStatus | null> {
  return (await window.desktop?.updater?.install()) ?? null;
}

export function onUpdaterStatus(listener: (status: UpdaterStatus) => void): () => void {
  const unsubscribe = window.desktop?.updater?.onStatus(listener);
  return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
}

export function requestAgent<T extends AgentEvent = Extract<AgentEvent, { type: "response" }>>(
  command: RequestCommand,
  timeoutMs = 45_000,
): Promise<T> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = timeoutMs;
    let started = performance.now();
    const approvals = new Map<string, ReturnType<typeof setTimeout>>();
    const surface = command.type === "modules.invoke" ? command : undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      for (const deadline of approvals.values()) clearTimeout(deadline);
      unsubscribe();
      callback();
    };
    const arm = (): void => {
      if (settled) return;
      started = performance.now();
      timer = setTimeout(
        () => {
          finish(() => reject(new Error("request timed out")));
        },
        Math.max(0, remaining),
      );
    };
    const resume = (id: string): void => {
      const deadline = approvals.get(id);
      if (deadline === undefined) return;
      clearTimeout(deadline);
      approvals.delete(id);
      if (approvals.size === 0) arm();
    };
    const unsubscribe = onAgentEvent((event) => {
      if (event.type === "agent.exit" || (surface && event.type === "project.changed")) {
        finish(() =>
          reject(
            new Error(
              event.type === "agent.exit" ? (event.message ?? "agent exited") : "project changed",
            ),
          ),
        );
        return;
      }
      if (
        surface &&
        event.type === "approval.requested" &&
        event.sessionId === surface.sessionId &&
        event.approval.callId === `module-ui-${surface.request.id}`
      ) {
        const approval = event.approval;
        if (!approvals.has(approval.id)) {
          if (approvals.size === 0) {
            clearTimeout(timer);
            remaining -= performance.now() - started;
          }
          approvals.set(
            approval.id,
            setTimeout(() => resume(approval.id), Math.max(0, approval.expiresAt - Date.now())),
          );
        }
        return;
      }
      if (surface && event.type === "approval.resolved" && event.sessionId === surface.sessionId) {
        resume(event.id);
        return;
      }
      if (event.type !== "response" || event.requestId !== requestId) return;
      if (!event.ok) {
        finish(() => reject(new Error(event.error ?? "request failed")));
        return;
      }
      finish(() => resolve(event as T));
    });
    arm();
    if (!sendAgent({ ...command, requestId } as AgentCommand)) {
      finish(() => reject(new Error("agent bridge is unavailable")));
    }
  });
}
