import { z } from "zod";
import type { EditorContext } from "./composer/context-types";
import { requestAgent } from "./desktop";
import { t } from "./i18n.svelte";
import { IdeGit } from "./ide/git.svelte";
import { IdeLayout } from "./ide/layout.svelte";
import { IdeSearch } from "./ide/search.svelte";
import { IdeTwinCorrection } from "./ide/twin-correction.svelte";
import {
  type IdeDocument,
  isDirty,
  parseIdeFile,
  refreshDocument,
  replaceFromDisk,
} from "./ide-document";
import type { AgentEvent } from "./types";

type Response = Extract<AgentEvent, { type: "response" }>;
type Pending = { path: string; action: "close" | "reload" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Project files are read and saved through the sidecar, never from the renderer. */
export class IdeWorkspace {
  readonly layout = new IdeLayout();
  readonly search = new IdeSearch();
  readonly git = new IdeGit();
  readonly correction = new IdeTwinCorrection();
  directories = $state<string[]>([]);
  location = $state<{
    path: string;
    line: number;
    column: number;
    length: number;
    token: number;
  } | null>(null);
  #closed: string[] = [];
  #closeQueue: string[] = [];
  #history: string[] = [];
  #historyIndex = -1;
  context = $state<EditorContext>({});
  tabs = $state<IdeDocument[]>([]);
  activePath = $state<string | null>(null);
  files = $state<string[]>([]);
  loadingFiles = $state(false);
  filesError = $state<string | null>(null);
  pending = $state<Pending | null>(null);
  #generation = 0;
  #refreshing: Promise<void> | null = null;
  #refreshAgain = false;
  #reads = new Map<string, number>();

  get active(): IdeDocument | null {
    return this.tabs.find((document) => document.path === this.activePath) ?? null;
  }

  setContext(next: EditorContext): void {
    if (
      this.context.selection?.source === next.selection?.source &&
      this.context.selection?.text === next.selection?.text &&
      this.context.symbol?.source === next.symbol?.source &&
      this.context.symbol?.text === next.symbol?.text
    )
      return;
    this.context = next;
  }

  get dirty(): boolean {
    return this.tabs.some(isDirty);
  }

  handle(event: AgentEvent): void {
    if (this.files.length === 0 && this.tabs.length === 0) return;
    if (
      event.type === "tool.finished" ||
      event.type === "job.finished" ||
      event.type === "session.finished"
    ) {
      void this.requestRefresh();
    }
  }

  select(path: string): void {
    if (this.tabs.some((document) => document.path === path)) {
      this.activePath = path;
      this.#remember(path);
    }
  }

  async open(path: string): Promise<void> {
    const existing = this.tabs.find((document) => document.path === path);
    this.activePath = path;
    this.#remember(path);
    if (existing) return;
    this.tabs.push({
      path,
      text: "",
      savedText: "",
      file: null,
      loading: true,
      saving: false,
      error: null,
      changedOnDisk: false,
    });
    await this.#read(path, false);
  }

  update(path: string, text: string): void {
    const document = this.tabs.find((entry) => entry.path === path);
    if (document?.file?.hash && !document.loading) document.text = text;
  }

  async save(path = this.activePath): Promise<boolean> {
    const document = this.tabs.find((entry) => entry.path === path);
    if (!document?.file?.hash || document.saving || document.loading) return false;
    if (!isDirty(document)) return true;
    const generation = this.#generation;
    const text = document.text;
    const before = document.savedText;
    this.#reads.set(document.path, (this.#reads.get(document.path) ?? 0) + 1);
    document.saving = true;
    document.error = null;
    try {
      const response = await requestAgent<Response>(
        {
          type: "files.write",
          path: document.path,
          text,
          expectedHash: document.file.hash,
        },
        15_000,
      );
      if (generation !== this.#generation || !this.tabs.includes(document)) return false;
      const file = parseIdeFile(response.file);
      document.file = file;
      document.savedText = text;
      document.changedOnDisk = false;
      this.correction.capture(document.path, before, text);
      return true;
    } catch (error) {
      if (generation === this.#generation && this.tabs.includes(document)) {
        document.error = t("Could not save. {0}", [errorMessage(error)]);
      }
      return false;
    } finally {
      document.saving = false;
    }
  }

  close(path: string): void {
    const document = this.tabs.find((entry) => entry.path === path);
    if (!document || document.saving) return;
    if (isDirty(document)) this.pending = { path, action: "close" };
    else this.#remove(path);
  }

  async reload(path = this.activePath): Promise<void> {
    const document = this.tabs.find((entry) => entry.path === path);
    if (!document || document.saving) return;
    if (isDirty(document)) this.pending = { path: document.path, action: "reload" };
    else await this.#read(document.path, true);
  }

  async resolvePending(choice: "save" | "discard" | "cancel"): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (choice === "cancel") {
      this.pending = null;
      this.#closeQueue = [];
      return;
    }
    if (choice === "save" && !(await this.save(pending.path))) return;
    if (this.pending !== pending) return;
    this.pending = null;
    if (pending.action === "close") this.#remove(pending.path);
    else await this.#read(pending.path, true);
    this.#continueClose();
  }

  async saveAll(): Promise<boolean> {
    for (const document of this.tabs.filter(isDirty))
      if (!(await this.save(document.path))) return false;
    return true;
  }

  closeMany(paths: string[]): void {
    this.#closeQueue = [...paths];
    this.#continueClose();
  }
  #continueClose(): void {
    while (!this.pending && this.#closeQueue.length) {
      const path = this.#closeQueue.shift();
      if (path) this.close(path);
    }
  }
  reopen(): void {
    const path = this.#closed.pop();
    if (path) void this.open(path);
  }
  cycle(direction: number): void {
    const index = this.tabs.findIndex((tab) => tab.path === this.activePath);
    const next = this.tabs[(index + direction + this.tabs.length) % this.tabs.length];
    if (next) this.select(next.path);
  }
  async openAt(path: string, line = 1, column = 1, length = 0): Promise<void> {
    await this.open(path);
    this.locate(path, line, column, length);
  }
  locate(path: string, line = 1, column = 1, length = 0): void {
    this.location = { path, line, column, length, token: (this.location?.token ?? 0) + 1 };
  }
  navigate(direction: number): void {
    const index = this.#historyIndex + direction;
    const path = this.#history[index];
    if (!path) return;
    this.#historyIndex = index;
    void this.open(path);
  }
  #remember(path: string): void {
    if (this.#history[this.#historyIndex] === path) return;
    this.#history = [...this.#history.slice(0, this.#historyIndex + 1), path].slice(-100);
    this.#historyIndex = this.#history.length - 1;
  }
  async change(
    operation: "create-file" | "create-folder" | "rename" | "trash",
    path: string,
    destination = "",
  ): Promise<void> {
    const affected = this.tabs.filter(
      (tab) => tab.path === path || tab.path.startsWith(`${path}/`),
    );
    if (operation === "rename" || operation === "trash") {
      if (affected.some((tab) => isDirty(tab) || tab.saving))
        throw new Error(t("Save or close modified files in this folder first."));
    }
    if (operation === "rename")
      await requestAgent({ type: "files.change", operation, path, destination });
    else if (operation === "trash")
      await requestAgent({ type: "files.change", operation, path, confirm: true });
    else
      await requestAgent({
        type: "files.change",
        operation: "create",
        path,
        directory: operation === "create-folder",
      });
    for (const tab of affected) {
      if (operation === "trash") this.#remove(tab.path);
      if (operation === "rename") {
        const next = destination + tab.path.slice(path.length);
        if (this.activePath === tab.path) this.activePath = next;
        tab.path = next;
        if (tab.file) tab.file.path = next;
      }
    }
    await this.requestRefresh();
    if (operation === "create-file") await this.open(path);
  }

  requestRefresh(): Promise<void> {
    if (this.#refreshing) {
      this.#refreshAgain = true;
      return this.#refreshing;
    }
    const generation = this.#generation;
    const refresh = async (): Promise<void> => {
      do {
        this.#refreshAgain = false;
        await this.#refresh(generation);
      } while (this.#refreshAgain && generation === this.#generation);
    };
    const promise = refresh().finally(() => {
      if (this.#refreshing === promise) this.#refreshing = null;
    });
    this.#refreshing = promise;
    return promise;
  }

  reset(): void {
    this.correction.reset();
    this.git.reset();
    this.search.reset();
    this.context = {};
    this.directories = [];
    this.location = null;
    this.#closed = [];
    this.#closeQueue = [];
    this.#history = [];
    this.#historyIndex = -1;
    this.#generation += 1;
    this.#refreshing = null;
    this.#refreshAgain = false;
    this.#reads.clear();
    this.tabs = [];
    this.activePath = null;
    this.files = [];
    this.loadingFiles = false;
    this.filesError = null;
    this.pending = null;
  }

  async #refresh(generation: number): Promise<void> {
    this.loadingFiles = true;
    this.filesError = null;
    try {
      const response = await requestAgent<Response>({ type: "files.list" }, 15_000);
      if (generation !== this.#generation) return;
      this.files = z.array(z.string()).parse(response.files);
      this.directories = z.array(z.string()).parse(response.directories ?? []);
      await Promise.all(
        this.tabs
          .filter((document) => !document.loading && !document.saving)
          .map((document) => this.#read(document.path, false)),
      );
    } catch (error) {
      if (generation === this.#generation) this.filesError = errorMessage(error);
    } finally {
      if (generation === this.#generation) this.loadingFiles = false;
    }
  }

  async #read(path: string, replace: boolean): Promise<void> {
    const document = this.tabs.find((entry) => entry.path === path);
    if (!document) return;
    if (replace) document.loading = true;
    const generation = this.#generation;
    const ticket = (this.#reads.get(path) ?? 0) + 1;
    this.#reads.set(path, ticket);
    const valid = (): boolean =>
      generation === this.#generation &&
      this.#reads.get(path) === ticket &&
      this.tabs.includes(document);
    try {
      const response = await requestAgent<Response>({ type: "files.read", path }, 15_000);
      if (!valid() || document.saving) return;
      const file = parseIdeFile(response.file);
      if (replace || !document.file) replaceFromDisk(document, file);
      else refreshDocument(document, file);
    } catch (error) {
      if (valid()) document.error = t("Could not open. {0}", [errorMessage(error)]);
    } finally {
      if (valid()) document.loading = false;
    }
  }

  #remove(path: string): void {
    const index = this.tabs.findIndex((document) => document.path === path);
    this.tabs = this.tabs.filter((document) => document.path !== path);
    if (this.activePath === path) {
      this.activePath = this.tabs[Math.min(index, this.tabs.length - 1)]?.path ?? null;
    }
    this.#reads.delete(path);
    this.#closed = [...this.#closed.filter((entry) => entry !== path), path].slice(-20);
  }
}
