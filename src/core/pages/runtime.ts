import type { Message, ToolCall, ToolResult } from "../types";
import type { PageAccess, PageArchive } from "./archive";
import {
  type ActivePage,
  ActivePageSchema,
  type PageCommand,
  type PageReport,
  parsePageCommand,
} from "./control";

interface PageState {
  active?: ActivePage;
  pending: boolean;
  blocked?: PageReport;
  finalResult?: string;
  dirty?: boolean;
}

/** Successful typed calls are the durable lifecycle; summaries carry an interrupted page. */
export class PageRuntime {
  #checkpointed = false;

  constructor(
    readonly messages: Message[],
    readonly archive?: PageArchive,
    readonly readOnlyTools: ReadonlySet<string> = new Set(),
  ) {}

  #state(): PageState {
    const calls = new Map<string, PageCommand>();
    const otherCalls = new Map<string, string>();
    let state: PageState = { pending: false };
    for (const message of this.messages) {
      if (message.role === "user" && message.contextSummary) {
        const active = ActivePageSchema.safeParse(message.contextSummary.activePage);
        const finalResult = message.contextSummary.checkpoint?.finalResult;
        state = {
          pending: false,
          ...(active.success ? { active: active.data } : {}),
          ...(typeof finalResult === "string" && finalResult.length > 0 ? { finalResult } : {}),
        };
        calls.clear();
        otherCalls.clear();
      } else if (message.role === "assistant") {
        for (const call of message.toolCalls) {
          if (call.name !== "context") {
            otherCalls.set(call.id, call.name);
            continue;
          }
          const command = parsePageCommand(call.args);
          if (command.success) calls.set(call.id, command.data);
        }
      } else if (message.role === "tool" && message.name !== "context" && !message.isError) {
        const name = otherCalls.get(message.toolCallId) ?? message.name;
        otherCalls.delete(message.toolCallId);
        if (
          !["criterion", "ask_talker", "done", "todo"].includes(name) &&
          !(this.canInspect() && this.readOnlyTools.has(name))
        ) {
          state = {
            ...state,
            dirty: true,
            ...(state.active
              ? {}
              : {
                  active: {
                    title: "Current logical block",
                    objective: "Complete and verify the current logical block.",
                  },
                }),
          };
        }
      } else if (message.role === "tool" && message.name === "context" && !message.isError) {
        const command = calls.get(message.toolCallId);
        calls.delete(message.toolCallId);
        if (command?.op === "begin" && (!state.active || state.dirty) && !state.pending) {
          state = {
            active: { title: command.title, objective: command.objective },
            pending: false,
          };
        } else if ((command?.op === "compact" || command?.op === "complete") && !state.pending) {
          state = {
            pending: true,
            ...(command.finalResult ? { finalResult: command.finalResult } : {}),
          };
        } else if (command?.op === "block" && !state.pending) {
          const { op: _op, ...blocked } = command;
          const active = state.active ?? {
            title: "Current logical block",
            objective: "Complete and verify the current logical block.",
          };
          state = { active, pending: true, blocked };
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

  finalResult(): string | undefined {
    return this.#state().finalResult;
  }

  /** Evidence reads remain available after a durable checkpoint, including restored history. */
  canInspect(): boolean {
    return (
      this.#checkpointed ||
      this.messages.some((message) => message.role === "user" && !!message.contextSummary)
    );
  }

  /** The loop records a successful semantic checkpoint made during this invocation. */
  checkpointed(): void {
    this.#checkpointed = true;
  }

  canFinish(): boolean {
    const state = this.#state();
    return !state.pending && !state.blocked;
  }

  guard(calls: ToolCall[]): string | undefined {
    for (const call of calls) {
      if (call.name === "context" && !parsePageCommand(call.args).success)
        return "Invalid context operation. Supply the exact fields required for that operation.";
    }
    const hasBegin = calls.some((call) => {
      if (call.name !== "context") return false;
      const command = parsePageCommand(call.args);
      return command.success && command.data.op === "begin";
    });
    const hasCompactOrBlock = calls.some((call) => {
      if (call.name !== "context") return false;
      const command = parsePageCommand(call.args);
      return (
        command.success &&
        (command.data.op === "compact" ||
          command.data.op === "complete" ||
          command.data.op === "block")
      );
    });
    if (hasBegin && hasCompactOrBlock) {
      return "Do not combine context begin with context compact or block in the same turn.";
    }
    if (hasCompactOrBlock) {
      const allowedWithCompact = calls.every((call) =>
        ["context", "criterion", "done"].includes(call.name),
      );
      if (!allowedWithCompact) {
        return "Call context compact alone (or with criterion report), after inspecting all previous tool results.";
      }
    }
    const state = this.#state();
    if (state.pending) return "The completed page must be compacted before any further tool call.";
    return undefined;
  }

  async execute(value: unknown, access?: PageAccess): Promise<ToolResult> {
    const parsed = parsePageCommand(value);
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
    const title =
      (command.op === "compact" || command.op === "complete" ? command.title : undefined) ??
      state.active?.title ??
      "Completed logical block";
    return {
      ok: true,
      output: [
        command.op === "block" ? "# Logical page blocked" : "# Logical page compacted",
        command.summary,
        ...(command.findings?.length ? ["## Findings", ...command.findings] : []),
        ...(command.result ? ["## Result", command.result] : []),
        ...(command.op !== "block" && command.finalResult
          ? ["## Final result", command.finalResult]
          : []),
        "## Evidence",
        ...command.evidence.map((item) => `- ${item}`),
        "## Next step",
        command.next,
        command.op === "block"
          ? "The harness must archive and compact this unfinished page before reporting the blocker."
          : "The harness must archive and compact this page before continuing.",
      ].join("\n\n"),
      data: { kind: "context_page", title, ...command },
    };
  }
}
