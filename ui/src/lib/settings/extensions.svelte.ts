import { composerDrafts, writeComposerDraft } from "../composer/drafts.svelte";
import { onAgentEvent, openExternal, requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import type { AgentEvent } from "../types";
import { focusComposer } from "../ui-polish";
import type {
  ElicitationValue,
  ExtensionContext,
  McpStatus,
  SkillMetadata,
} from "./extension-types";

type Response = Extract<AgentEvent, { type: "response" }>;

class ExtensionStore {
  mcp = $state<McpStatus | null>(null);
  skills = $state<SkillMetadata[]>([]);
  busy = $state(false);
  error = $state("");
  consent = $state<string | null>(null);
  resource = $state<{ name: string; path: string; text: string; truncated: boolean } | null>(null);
  async previewSkill(name: string, path: string): Promise<void> {
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "skills.resource", name, path });
      this.resource = response.resource ?? null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
  async refresh(): Promise<void> {
    try {
      const response = await requestAgent<Response>({ type: "mcp.status" });
      if (response.mcp) this.mcp = response.mcp;
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    }
  }
  async reconnect(id: string): Promise<void> {
    this.busy = true;
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "mcp.reconnect", id }, 180_000);
      if (response.mcp) this.mcp = response.mcp;
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    } finally {
      this.busy = false;
    }
  }
  async loadSkills(reload = false): Promise<void> {
    this.busy = true;
    this.error = "";
    try {
      const response = await requestAgent<Response>({
        type: reload ? "skills.reload" : "skills.list",
      });
      if (response.skills) this.skills = response.skills;
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    } finally {
      this.busy = false;
    }
  }
  async authorize(id: string): Promise<void> {
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "mcp.oauth.start", id });
      if (response.authorization?.url) await openExternal(response.authorization.url);
      this.consent = null;
      await this.refresh();
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    }
  }
  async answer(
    id: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, ElicitationValue>,
  ): Promise<void> {
    this.error = "";
    try {
      await requestAgent<Response>({
        type: "mcp.elicitation.respond",
        id,
        response: { action, ...(content ? { content } : {}) },
      });
      await this.refresh();
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    }
  }
  async context(
    server: string,
    source: { uri: string } | { name: string; args?: Record<string, string> },
  ): Promise<void> {
    this.error = "";
    try {
      const response = await requestAgent<Response>(
        "uri" in source
          ? { type: "mcp.resource", server, uri: source.uri }
          : { type: "mcp.prompt", server, ...source },
      );
      if (!response.attachedContext) throw new Error(t("The server returned no context"));
      this.attach(response.attachedContext);
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
    }
  }
  attach(context: ExtensionContext): void {
    const existing = composerDrafts.values[composerDrafts.task] ?? "";
    writeComposerDraft(`${existing}${existing ? "\n\n" : ""}${context.text}`);
    composerDrafts.insertion += 1;
    focusComposer();
  }
}

export const extensions = new ExtensionStore();

export function watchExtensions(): () => void {
  let pending = false;
  let disposed = false;
  const refresh = async () => {
    if (pending || disposed || document.hidden) return;
    pending = true;
    await extensions.refresh();
    pending = false;
  };
  const stop = onAgentEvent((event) => {
    if (event.type === "status" || event.type === "session.started") void refresh();
  });
  const timer = setInterval(() => void refresh(), 2000);
  void refresh();
  return () => {
    disposed = true;
    stop();
    clearInterval(timer);
  };
}
