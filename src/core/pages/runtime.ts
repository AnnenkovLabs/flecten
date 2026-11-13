import type { Message, ToolCall, ToolResult } from "../types";
import type { PageAccess, PageArchive } from "./archive";
import {
  type ActivePage,
  ActivePageSchema,
  type PageCommand,
  PageCommandSchema,
  type PageReport,
} from "./control";

interface PageState {
  active?: ActivePage;
  pending: boolean;
  blocked?: PageReport;
}

/** Successful typed calls are the durable lifecycle; summaries carry an interrupted page. */
export class PageRuntime {
  #checkpointed = false;

  constructor(
    readonly messages: Message[],
    readonly archive?: PageArchive,
  ) {}

  #state(): PageState {
    const calls = new Map<string, PageCommand>();
    let state: PageState = { pending: false };
    for (const message of this.messages) {
      if (message.role === "user" && message.contextSummary) {
        const active = ActivePageSchema.safeParse(message.contextSummary.activePage);
        state = { pending: false, ...(active.success ? { active: active.data } : {}) };
        calls.clear();
      } else if (message.role === "assistant") {
        for (const call of message.toolCalls) {
          if (call.name !== "context") continue;
          const command = PageCommandSchema.safeParse(call.args);
          if (command.success) calls.set(call.id, command.data);
        }
      } else if (message.role === "tool" && message.name === "context" && !message.isError) {
        const command = calls.get(message.toolCallId);
        calls.delete(message.toolCallId);
        if (command?.op === "begin" && !state.active && !state.pending) {
          state = {
            active: { title: command.title, objective: command.objective },
            pending: false,
          };
        } else if (command?.op === "complete" && state.active && !state.pending) {
          state = { pending: true };
        } else if (command?.op === "block" && state.active && !state.pending) {
          const { op: _op, ...blocked } = command;
          state = { active: state.active, pending: true, blocked };
        }
      }
    }
    return state;
  }

  active(): ActivePage | undefined {
    return this.#state().active;
  }

  pending(): boolean {
    return this.#state().pending;
  }

  /** Read before compaction replaces the pending block call with its continuation. */
  blocked(): PageReport | undefined {
    return this.#state().blocked;
  }

  /** The loop records a successful semantic checkpoint made during this invocation. */
  checkpointed(): void {
    this.#checkpointed = true;
  }

  canFinish(): boolean {
    const state = this.#state();
    return this.#checkpointed && !state.active && !state.pending;
  }

  guard(calls: ToolCall[]): string | undefined {
    for (const call of calls) {
      if (call.name === "context" && !PageCommandSchema.safeParse(call.args).success)
        return "Invalid context operation. Supply the exact fields required for that operation.";
    }
    const lifecycle = calls.some((call) => {
      if (call.name !== "context") return false;
      const command = PageCommandSchema.safeParse(call.args);
      return command.success && ["begin", "complete", "block"].includes(command.data.op);
    });
    if (lifecycle && calls.length !== 1) {
      return "Call context begin, complete or block alone, after inspecting all previous tool results.";
    }
    const state = this.#state();
    if (state.pending) return "The completed page must be compacted before any further tool call.";
    if (!state.active && calls.some((call) => call.name !== "context" && call.name !== "done")) {
      return "Start one small logical page with context begin before using work tools.";
    }
    if (!this.canFinish() && calls.some((call) => call.name === "done")) {
      return "Complete and checkpoint one logical page in this run before finishing the task.";
    }
    return undefined;
  }

  async execute(value: unknown, access?: PageAccess): Promise<ToolResult> {
    const parsed = PageCommandSchema.safeParse(value);
    if (!parsed.success) return { ok: false, output: "", error: parsed.error.message };
    const command = parsed.data;
    if (command.op === "list" || command.op === "read" || command.op === "search") {
      if (!this.archive) return { ok: false, output: "", error: "Page archive is unavailable." };
      if (command.op === "list") return this.archive.list(access);
      if (command.op === "read") {
        const { op: _op, ...input } = command;
        return this.archive.read(input, access);
      }
      const { op: _op, ...input } = command;
      return this.archive.search(input, access);
    }
    const state = this.#state();
    if (state.pending) {
      return { ok: false, output: "", error: "Wait for the completed page to be compacted." };
    }
    if (command.op === "begin") {
      if (state.active) {
        return {
          ok: false,
          output: "",
          error: "Complete the active page before beginning another.",
        };
      }
      return {
        ok: true,
        output: `# Active logical page\n\nTitle: ${command.title}\n\nObjective: ${command.objective}`,
        data: { kind: "context_page", ...command },
      };
    }
    if (!state.active) return { ok: false, output: "", error: "No logical page is active." };
    return {
      ok: true,
      output: [
        command.op === "block" ? "# Logical page blocked" : "# Logical page completed",
        command.summary,
        "## Evidence",
        ...command.evidence.map((item) => `- ${item}`),
        "## Next step",
        command.next,
        command.op === "block"
          ? "The harness must archive and compact this unfinished page before reporting the blocker."
          : "The harness must archive and compact this page before continuing.",
      ].join("\n\n"),
      data: { kind: "context_page", title: state.active.title, ...command },
    };
  }
}
