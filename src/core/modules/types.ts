import type { z } from "zod";
import type { ModuleFrameRequestSchema, ModuleReference } from "../../../shared/modules";
import type { ToolContext } from "../../tools/types";
import type { HooksConfig } from "../hooks/types";
import type { Message, ToolResult } from "../types";

export interface ModuleDelivery {
  text: string;
  references: ModuleReference[];
}
export interface ModuleSurfaceInput {
  name: string;
  surface: string;
  revision: string;
  request: z.infer<typeof ModuleFrameRequestSchema>;
}
/** Core depends on a session port; module files, transports and UI stay outside it. */
export interface ModuleSessionPort {
  /** Explicitly share module instances within one conversation; tool authority stays session-local. */
  shareSession?(ownerId: string, participantId: string): Promise<void>;
  services?(sessionId?: string): import("../services/registry").Services;
  prepare(sessionId: string, history: readonly Message[], signal: AbortSignal): Promise<void>;
  beforeTurn(
    sessionId: string,
    history: readonly Message[],
    signal: AbortSignal,
  ): Promise<ModuleDelivery | undefined>;
  hooks(sessionId: string): HooksConfig;
  invokeSurface(input: ModuleSurfaceInput, context: ToolContext): Promise<ToolResult>;
  close(sessionId: string): Promise<void>;
}
