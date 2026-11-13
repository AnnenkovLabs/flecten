import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";

export const MODULE_API_VERSION = 1;

/** Default-export this setup function from runtime.entry. The host supplies the standard MCP SDK. */
export interface ModuleHost {
  apiVersion: typeof MODULE_API_VERSION;
  server: McpServer;
  z: typeof z;
  workspace: string;
  moduleRoot: string;
}
/** Returned cleanup is awaited on transport closure or process shutdown. */
export type ModuleCleanup = () => void | Promise<void>;
export type ModuleSetup = (
  host: ModuleHost,
) => void | ModuleCleanup | Promise<void> | Promise<ModuleCleanup | undefined>;
