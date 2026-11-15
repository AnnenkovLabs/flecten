import type { AgentInfo } from "../agent-types";
import type { ModelInfo, ProviderProtocol, ProviderSettings } from "../types";

export interface ProbeResult {
  text: boolean;
  tools: boolean;
  reasoning?: boolean;
  latencyMs: number;
  error?: string;
}

export interface ProviderActualizeResult {
  providerId: string;
  modelMetadataBaseline?: Record<string, ModelInfo>;
  info: AgentInfo;
  models: number;
  added: string[];
  updated: string[];
  removed: string[];
  warnings: string[];
  probedModel: string;
  probe: ProbeResult;
}

export interface ModelMetadataResult {
  model: ModelInfo;
  warnings: string[];
}

export type ProviderCommand =
  | { type: "catalog.list"; requestId: string }
  | { type: "catalog.provider"; requestId: string; id: string }
  | { type: "catalog.status"; requestId: string }
  | { type: "catalog.sync"; requestId: string }
  | { type: "provider.actualize"; requestId: string; id: string }
  | { type: "provider.reauthorize"; requestId: string; id: string; model: string }
  | { type: "model.probe"; requestId: string; provider: string; model: string }
  | {
      type: "provider.discover";
      requestId: string;
      protocol: ProviderProtocol;
      baseUrl: string;
      apiKey?: string;
      headers?: Record<string, string>;
    }
  | {
      type: "provider.test";
      requestId: string;
      model: string;
      providerId?: string;
      draftToken?: string;
    }
  | {
      type: "model.metadata";
      requestId: string;
      model: string;
      providerId?: string;
      draftToken?: string;
      refresh?: boolean;
    }
  | { type: "provider.draft"; requestId: string; provider: ProviderSettings; providerId?: string }
  | {
      type: "model.set";
      requestId: string;
      provider: string;
      model: string;
      sessionId?: string;
      reasoning?: import("../types").ReasoningEffort;
      variant?: string;
    };
