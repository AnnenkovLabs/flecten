import type { SubagentInfo, SubagentResult } from "../../../../shared/subagents";
import { toolAction } from "../agent";
import type { AgentEvent, AgentToolCall, RunAction } from "../types";
import { ThreadView } from "./thread.svelte";
import { emptyTokenUsage, tokenUsageEvent } from "./token-usage";

export interface SubagentView extends SubagentInfo {
  status: "running" | "succeeded" | "failed" | "stopped" | "interrupted";
  thread: ThreadView;
  usage: ReturnType<typeof emptyTokenUsage>;
  result?: SubagentResult;
  stopping: boolean;
  messages: string[];
}
type ChildEvent = Extract<
  AgentEvent,
  { type: "subagent.started" | "subagent.event" | "subagent.finished" }
>;

/** Each child keeps its own transcript; parent stop events never settle these views. */
export class SubagentsView {
  items = $state<SubagentView[]>([]);
  reset(): void {
    this.items = [];
  }
  disconnected(): void {
    for (const item of this.items)
      if (item.status === "running") {
        item.status = "interrupted";
        item.stopping = false;
        item.thread.interruptTools();
      }
  }
  apply(
    envelope: ChildEvent,
    timing: Pick<AgentEvent, "timestamp" | "reasoningStartedAt"> = envelope,
  ): void {
    if (envelope.type === "subagent.started") {
      if (this.items.some((item) => item.id === envelope.subagent.id)) return;
      this.items.push({
        ...envelope.subagent,
        status: "running",
        thread: new ThreadView(),
        usage: emptyTokenUsage(),
        stopping: false,
        messages: [],
      });
      return;
    }
    const item = this.items.find((entry) => entry.id === envelope.id);
    if (!item) return;
    if (envelope.type === "subagent.finished") {
      item.result = envelope.result;
      item.status = envelope.cancelled ? "stopped" : envelope.result.ok ? "succeeded" : "failed";
      item.stopping = false;
      item.thread.interruptTools();
      return;
    }
    const event = envelope.event;
    item.usage = tokenUsageEvent(item.usage, event);
    const thread = item.thread;
    switch (event.type) {
      case "session.started":
        thread.beginRun(null, undefined, timing.timestamp);
        return;
      case "turn.started":
        thread.turnStarted(event.turn, timing.timestamp);
        return;
      case "message.started":
        thread.appendText("");
        return;
      case "message.delta":
        thread.appendText(event.text);
        return;
      case "reasoning.delta":
        thread.reasoningDelta(event.text, timing.timestamp);
        return;
      case "message.reset":
        thread.messageReset();
        return;
      case "message.finished":
        if (event.toolCalls.length > 0 && event.text.trim())
          item.messages.push(event.display?.text ?? event.text);
        thread.finishMessage(
          event.display?.text ?? event.text,
          event.display?.reasoning ?? event.reasoning,
          event.toolCalls,
          event.display?.summary ?? event.summary,
          timing.timestamp,
          timing.reasoningStartedAt,
        );
        return;
      case "tool_call.progress":
        thread.progressToolCall(event.index, event.name, event.delta);
        return;
      case "tool.started":
        thread.startTool(event.call);
        return;
      case "tool.output":
        thread.toolOutput(event.callId, event.text);
        return;
      case "tool.finished":
        thread.finishTool(event.call, event.result);
        return;
      case "session.finished":
        thread.finishRun(event.result, timing.timestamp);
        return;
      case "error":
        thread.note("x", "", "", event.message);
        return;
    }
  }
  action(item: SubagentView): RunAction {
    const call: AgentToolCall = {
      id: item.callId,
      name: "task",
      args: { agent: item.agent, prompt: item.prompt },
    };
    const result = item.result;
    const action = toolAction(
      call,
      result
        ? {
            ok: result.ok,
            output: result.summary,
            ...(result.error ? { error: result.error } : {}),
            data: { kind: "subagent", agent: item.agent, data: result.data, usage: result.usage },
          }
        : undefined,
    );
    return {
      ...action,
      subagent: item,
      running: item.status === "running",
      state:
        item.status === "stopped"
          ? "cancelled"
          : item.status === "interrupted"
            ? "interrupted"
            : item.status === "running"
              ? "queued"
              : item.status,
      failed: item.status === "failed" || item.status === "interrupted",
    };
  }
}
