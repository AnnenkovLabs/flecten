import type { ModelConfig, ProviderConfig } from "../config/schema";
import type { Message, ReasoningEffort, ToolCall } from "../core/types";
import type { ProviderFetch } from "./transport";

export type StopReason = "end" | "tool_use" | "max_tokens";

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  maxTokens: number;
  temperature?: number;
  reasoning?: ReasoningEffort;
  variant?: string;
  apiModel?: string;
  toolChoice?: "auto" | "required" | "none";
}

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown; extraContent?: unknown }
  | { type: "provider_data"; data: unknown }
  | {
      type: "tool_call_progress";
      index: number;
      name?: string;
      delta?: string;
    }
  | {
      type: "usage";
      input: number;
      output: number;
      cached: number;
      reasoning?: number;
      cacheWrite?: number;
    }
  /** Failover moved the request to a fallback model; it comes right before that model's output. */
  | { type: "route"; provider: string; model: string; reason: string }
  | { type: "done"; reason: StopReason };

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

export interface ProviderRuntime {
  providerId: string;
  protocol: ProviderConfig["protocol"];
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
  fetch?: ProviderFetch;
  config: ProviderConfig;
  modelConfig(id: string): ModelConfig | undefined;
}

export interface ActiveProvider {
  id: string;
  protocol: string;
  model: string;
  provider: ModelProvider;
}

export interface ToolCallPayload {
  id: string;
  name: string;
  args: unknown;
}

export type { Message, ToolCall };
