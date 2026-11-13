import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { MODULE_API_VERSION, type ModuleSetup } from "./sdk";

/** Runs only in a dedicated child process, never in the sidecar or renderer. */
export async function runModuleHost(entry: string): Promise<void> {
  const env = z
    .object({
      FLECTEN_MODULE_NAME: z.string().min(1),
      FLECTEN_MODULE_VERSION: z.string().min(1),
      FLECTEN_WORKSPACE: z.string().min(1),
      FLECTEN_MODULE_ROOT: z.string().min(1),
    })
    .parse(process.env);
  const loaded = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  if (typeof loaded.default !== "function")
    throw new Error("Module runtime.entry must default-export a setup function");
  const server = new McpServer({
    name: env.FLECTEN_MODULE_NAME,
    version: env.FLECTEN_MODULE_VERSION,
  });
  const cleanup = await (loaded.default as ModuleSetup)({
    apiVersion: MODULE_API_VERSION,
    server,
    z,
    workspace: env.FLECTEN_WORKSPACE,
    moduleRoot: env.FLECTEN_MODULE_ROOT,
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await cleanup?.();
    } finally {
      await server.close();
    }
  };
  const close = () => {
    void shutdown().catch(() => {
      process.exitCode = 1;
    });
  };
  server.server.onclose = close;
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  process.once("disconnect", close);
  process.stdin.once("end", close);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await shutdown();
    throw error;
  }
}
