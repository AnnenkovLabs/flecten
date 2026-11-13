import type { AgentMcpServer } from "../agent-types";

export type ElicitationValue = string | number | boolean | string[];
export interface ElicitationRequest {
  id: string;
  server: string;
  createdAt: number;
  mode: "form" | "url";
  message: string;
  url?: string;
  requestedSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}
export interface ExtensionContext {
  text: string;
  tokens: number;
  truncated: boolean;
}
export interface ExtensionPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}
export interface McpStatus {
  servers: AgentMcpServer[];
  tools: Array<{ name: string; description: string }>;
  logs: Array<{ server: string; message: string }>;
  catalogs: Array<{
    server: string;
    resources: Array<{ uri: string; name: string; description?: string }>;
    prompts: ExtensionPrompt[];
  }>;
  elicitation: ElicitationRequest[];
  authorizations: Array<{
    server: string;
    state: "pending" | "authorized" | "error";
    error?: string;
  }>;
}
export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
  directory: string;
  source: string;
  trust: string;
  version?: string;
  allowedTools?: string[];
  resources: string[];
}
