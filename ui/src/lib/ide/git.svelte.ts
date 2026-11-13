import { z } from "zod";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";

const Entry = z.object({
  path: z.string(),
  original: z.string().optional(),
  index: z.string(),
  worktree: z.string(),
});
const Status = z.object({ branch: z.string(), repository: z.boolean(), entries: z.array(Entry) });
export class IdeGit {
  status = $state<z.infer<typeof Status> | null>(null);
  diff = $state<{ path: string; text: string; staged: boolean } | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  message = $state("");
  #ticket = 0;
  #diffRequest = 0;
  async refresh(): Promise<void> {
    await this.#request({ action: "status" });
  }
  async change(action: "stage" | "unstage", path: string): Promise<void> {
    await this.#request({ action, path });
  }
  async commit(): Promise<void> {
    if (await this.#request({ action: "commit", message: this.message })) this.message = "";
  }
  async show(path: string, staged: boolean): Promise<void> {
    const ticket = this.#ticket;
    const request = ++this.#diffRequest;
    this.error = null;
    try {
      const response = await requestAgent({ type: "files.git", action: "diff", path, staged });
      const diff = z
        .object({ path: z.string(), text: z.string(), staged: z.boolean() })
        .parse(response.git);
      if (ticket === this.#ticket && request === this.#diffRequest) this.diff = diff;
    } catch (error) {
      if (ticket === this.#ticket && request === this.#diffRequest) this.error = String(error);
    }
  }
  reset(): void {
    this.#ticket += 1;
    this.busy = false;
    this.status = null;
    this.diff = null;
    this.error = null;
    this.message = "";
  }
  async #request(
    command:
      | { action: "status" }
      | { action: "stage" | "unstage"; path: string }
      | { action: "commit"; message: string },
  ): Promise<boolean> {
    if (this.busy) return false;
    const ticket = this.#ticket;
    this.busy = true;
    this.error = null;
    try {
      const response = await requestAgent({ type: "files.git", ...command }, 20_000);
      if (ticket !== this.#ticket) return false;
      this.status = Status.parse(response.git);
      return true;
    } catch (error) {
      if (ticket === this.#ticket)
        this.error = t("Git: {0}. Fix the issue and refresh the list.", [String(error)]);
      return false;
    } finally {
      if (ticket === this.#ticket) this.busy = false;
    }
  }
}
