import type { AgentSessionSummary } from "../agent-types";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import type { McpStatus } from "../settings/extension-types";
import type { EditorContext } from "./context-types";
import type { MentionItem } from "./types";

export function contextMentions(
  editor: EditorContext,
  sessions: readonly AgentSessionSummary[],
  mcp: McpStatus | null,
): MentionItem[] {
  return [
    ...[editor.selection, editor.symbol].flatMap((context) =>
      context ? [{ path: context.label, label: context.label, kind: context.kind, context }] : [],
    ),
    ...sessions.map(
      (session): MentionItem => ({
        path: `task:${session.id}`,
        label: session.title,
        kind: "task",
        ...(session.lastPrompt ? { preview: session.lastPrompt } : {}),
        context: {
          kind: "task",
          source: `liquid://sessions/${session.id}`,
          label: session.title,
          text: `Task: ${session.id}\nStatus: ${session.running ? "running" : (session.stopReason ?? "idle")}\nLast user prompt:\n${(session.lastPrompt ?? "").slice(0, 58_000)}`,
        },
      }),
    ),
    ...(mcp?.catalogs ?? []).flatMap((catalog) =>
      catalog.resources.map(
        (resource): MentionItem => ({
          path: `${catalog.server}:${resource.uri}`,
          kind: "mcp-resource",
          label: resource.name,
          ...(resource.description ? { preview: resource.description } : {}),
          resource: { server: catalog.server, uri: resource.uri },
        }),
      ),
    ),
  ];
}

export function pullRequestMention(query: string): MentionItem[] {
  try {
    const url = new URL(query);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      parts.length !== 4 ||
      parts[2] !== "pull" ||
      !Number.isSafeInteger(Number(parts[3])) ||
      Number(parts[3]) <= 0
    )
      return [];
    return [
      {
        path: url.href,
        kind: "pull-request",
        label: `${parts[0]}/${parts[1]} #${parts[3]}`,
        preview: t("Attach a PR description from GitHub"),
      },
    ];
  } catch {
    return [];
  }
}

export async function resolveMention(item: MentionItem): Promise<MentionItem> {
  if (item.resource) {
    const response = await requestAgent({ type: "mcp.resource", ...item.resource });
    if (!response.attachedContext) throw new Error(t("MCP returned no resource"));
    return {
      ...item,
      context: {
        kind: "mcp-resource",
        label: item.label ?? item.path,
        source: item.path,
        text: response.attachedContext.text.slice(0, 60_000),
      },
    };
  }
  if (item.kind === "pull-request" && !item.context) {
    const response = await requestAgent({ type: "context.pull-request", url: item.path }, 20_000);
    if (!response.contextReference) throw new Error(t("GitHub returned no PR"));
    return { ...item, context: response.contextReference };
  }
  return item;
}
