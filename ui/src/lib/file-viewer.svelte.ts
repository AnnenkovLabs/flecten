import { requestAgent } from "./desktop";
import { t } from "./i18n.svelte";
import type { AgentEvent, AgentFilePreview } from "./types";

type Response = Extract<AgentEvent, { type: "response" }>;

export interface FileView {
  /** Path the card asked for: a project file or the full log of a tool. */
  path: string;
  /** 1-based line to scroll to, as the `offset` of a `read` call. */
  line?: number;
  loading: boolean;
  file?: AgentFilePreview;
  error?: string;
}

/** The built-in viewer: one file at a time, read through the core's bounded `files.read`. */
class FileViewer {
  current = $state<FileView | null>(null);
  #request = 0;

  async open(path: string, line?: number): Promise<void> {
    const request = ++this.#request;
    const base = { path, ...(line !== undefined && line > 1 ? { line } : {}) };
    this.current = { ...base, loading: true };
    try {
      const response = await requestAgent<Response>({ type: "files.read", path }, 15_000);
      if (request !== this.#request) return;
      this.current = response.file
        ? { ...base, loading: false, file: response.file }
        : { ...base, loading: false, error: t("the core returned no file") };
    } catch (error) {
      if (request !== this.#request) return;
      this.current = {
        ...base,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  close(): void {
    this.#request += 1;
    this.current = null;
  }
}

export const fileViewer = new FileViewer();
