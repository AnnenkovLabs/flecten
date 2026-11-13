import type { MessageKey } from "./i18n/catalogs";
import { t } from "./i18n.svelte";
import type { AgentToolCall, IconName, RunAction } from "./types";

const TOOLS: Record<string, { label: MessageKey; icon: IconName; field?: string }> = {
  read: { label: "Read file", icon: "file", field: "path" },
  write: { label: "Write file", icon: "edit", field: "path" },
  edit: { label: "Edit file", icon: "edit", field: "path" },
  apply_patch: { label: "Apply changes", icon: "edit" },
  delete: { label: "Delete file", icon: "trash", field: "path" },
  move: { label: "Move file", icon: "file", field: "from" },
  todo: { label: "Update plan", icon: "tasks", field: "content" },
  task: { label: "Subagent", icon: "brain", field: "prompt" },
  grep: { label: "Search file contents", icon: "search", field: "pattern" },
  glob: { label: "Find files", icon: "search", field: "pattern" },
  ask: { label: "Ask a question", icon: "tasks", field: "question" },
  web_fetch: { label: "Read web page", icon: "file", field: "url" },
  web_search: { label: "Search the web", icon: "search", field: "query" },
  git: { label: "Git", icon: "branch", field: "path" },
  lsp: { label: "Check code", icon: "search", field: "path" },
  terminal: { label: "Terminal", icon: "terminal", field: "command" },
  bash: { label: "Run command", icon: "terminal", field: "command" },
  jobs: { label: "Background jobs", icon: "terminal", field: "id" },
  skill: { label: "Use skill", icon: "spark", field: "name" },
  module: { label: "Modules", icon: "layers", field: "name" },
  worker: { label: "Worker", icon: "brain", field: "task" },
  done: { label: "Complete task", icon: "check", field: "summary" },
  memory: { label: "Project memory", icon: "brain", field: "query" },
};

const OPERATIONS: Record<string, Record<string, MessageKey>> = {
  git: {
    status: "Git status",
    diff: "Review changes",
    log: "Commit history",
    show: "View commit",
    branch: "Git branches",
    commit: "Create commit",
  },
  lsp: {
    diagnostics: "Check code",
    definition: "Find definition",
    references: "Find references",
    symbols: "List symbols",
    rename: "Preview rename",
    format: "Format file",
  },
  terminal: {
    run: "Run command",
    write: "Send terminal input",
    read: "Read terminal output",
    resize: "Resize terminal",
    kill: "Stop terminal",
    list: "List terminals",
  },
  jobs: {
    list: "List background jobs",
    output: "Read job output",
    wait: "Wait for job",
    stop: "Stop job",
  },
  todo: {
    list: "View plan",
    add: "Update plan",
    update: "Update plan",
    remove: "Update plan",
    clear: "Update plan",
  },
  worker: {
    start: "Start worker",
    steer: "Send worker instruction",
    status: "Worker status",
    stop: "Stop worker",
  },
  memory: {
    list: "Browse memory",
    read: "Read memory",
    sources: "Memory sources",
    save: "Save memory",
    forget: "Forget memory",
  },
};

function own<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

export function toolArgs(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function textArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] : "";
}

export function toolName(name: string, args: unknown = {}): string {
  const input = toolArgs(args);
  if (name === "task") {
    const agent = textArg(input, "agent");
    const roles: Record<string, MessageKey> = {
      explore: "Researcher",
      implement: "Developer",
      review: "Reviewer",
    };
    const role = own(roles, agent);
    return agent ? t("Subagent: {0}", [role ? t(role) : agent]) : t("Subagent");
  }
  const operation = textArg(input, "operation") || textArg(input, "op");
  const operations = own(OPERATIONS, name);
  const label = (operations ? own(operations, operation) : undefined) ?? own(TOOLS, name)?.label;
  return label ? t(label) : name ? t("Tool: {0}", [name]) : t("Preparing action");
}

export function presentationIcon(name: string): IconName {
  return own(TOOLS, name)?.icon ?? "server";
}

export function toolSubject(call: AgentToolCall): string {
  const args = toolArgs(call.args);
  if (call.name === "move") return `${textArg(args, "from")} → ${textArg(args, "to")}`;
  if (call.name === "memory")
    return textArg(args, "query") || textArg(args, "summary") || textArg(args, "id");
  if (call.name === "worker") return textArg(args, "task") || textArg(args, "message");
  const field = own(TOOLS, call.name)?.field;
  return field ? textArg(args, field) : "";
}

export function toolState(action: RunAction): MessageKey | undefined {
  if (!action.tool) return undefined;
  if (action.state === "interrupted") return "Interrupted";
  if (action.state === "cancelled") return "Stopped";
  if (action.failed) return "Failed";
  if (action.running) return "Running";
  return action.state === "succeeded" ? "Finished" : "Queued";
}
