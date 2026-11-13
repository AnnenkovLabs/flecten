import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_SURFACE_BYTES } from "../../shared/module-interface";
import type { HooksConfig } from "../core/hooks/types";
import type { Services } from "../core/services/registry";
import { type McpServerConfig, McpServerConfigSchema } from "../mcp/config";
import { connectMcpServers, type McpSessionOptions, type McpSessionRuntime } from "../mcp/session";
import type { ToolContext } from "../tools/types";
import type { CatalogModule } from "./catalog";
import { materializeModule, moduleText } from "./package";
import { ModulePlatform } from "./platform";

export interface ModuleRuntimeOptions extends McpSessionOptions {
  requestTrust?(context: ToolContext): Promise<void>;
  services?(sessionId?: string): Services;
  sessionId?: string;
  reportPlatformError?(owner: string, error: unknown): void;
  registerRuntime?(runtime: McpSessionRuntime): () => void;
}

export class ModuleGeneration {
  #users = 0;
  #retired = false;
  #closing: Promise<void> | undefined;
  readonly hooks: HooksConfig;

  private constructor(
    readonly module: CatalogModule,
    readonly root: string,
    readonly mcp: McpSessionRuntime,
    readonly cleanup: () => Promise<void>,
    readonly platform?: ModulePlatform,
  ) {
    this.hooks = Object.fromEntries(
      Object.entries(module.manifest.hooks).map(([event, hooks]) => [
        event,
        hooks.map((hook) => ({
          ...hook,
          source: {
            type: "module" as const,
            name: module.manifest.name,
            revision: module.revision,
          },
          env: { ...hook.env, FLECTEN_MODULE_ROOT: root },
        })),
      ]),
    );
  }

  static async open(
    cwd: string,
    module: CatalogModule,
    options: ModuleRuntimeOptions,
    signal: AbortSignal,
  ): Promise<ModuleGeneration> {
    signal.throwIfAborted();
    const source = await materializeModule(cwd, module);
    let mcp: McpSessionRuntime | undefined;
    let platform: ModulePlatform | undefined;
    try {
      if (module.manifest.platform?.scope === "session" && options.services)
        platform = await ModulePlatform.open(
          module,
          source.root,
          cwd,
          options.sessionId,
          options.services(options.sessionId),
          signal,
          options.reportPlatformError,
        );
      const servers: Record<string, McpServerConfig> = Object.fromEntries(
        Object.entries(module.manifest.mcp.servers).map(([id, server]) => [
          id,
          "url" in server
            ? server
            : {
                ...server,
                cwd: server.cwd ? moduleDirectory(source.root, server.cwd) : source.root,
                env: { ...server.env, FLECTEN_MODULE_ROOT: source.root, FLECTEN_WORKSPACE: cwd },
              },
        ]),
      );
      if (module.manifest.runtime) {
        const sourceEntry = fileURLToPath(new URL("../app/server.ts", import.meta.url));
        const prefix = Bun.isStandaloneExecutable ? [] : [sourceEntry];
        servers.runtime = McpServerConfigSchema.parse({
          command: process.execPath,
          args: [...prefix, "--module-host", join(source.root, module.manifest.runtime.entry)],
          cwd: source.root,
          env: {
            FLECTEN_WORKSPACE: cwd,
            FLECTEN_MODULE_ROOT: source.root,
            FLECTEN_MODULE_NAME: module.manifest.name,
            FLECTEN_MODULE_VERSION: module.manifest.version,
          },
        });
      }
      const scoped = Object.fromEntries(
        Object.entries(servers).map(([id, server]) => [
          `module_${module.manifest.name}__${id}`,
          server,
        ]),
      );
      mcp = await connectMcpServers(scoped, cwd, options);
      signal.throwIfAborted();
      const failed = mcp.statuses.filter((status) => status.state !== "ready" && !status.oauth);
      if (failed.length)
        throw new Error(failed.map((s) => `${s.id}: ${s.error ?? s.state}`).join("; "));
      const unregister = options.registerRuntime?.(mcp);
      return new ModuleGeneration(
        module,
        source.root,
        mcp,
        async () => {
          unregister?.();
          if (platform) {
            platform.effects.unshift(source.close);
            await platform.layer.retire();
          } else await source.close();
        },
        platform,
      );
    } catch (error) {
      await mcp?.close();
      await platform?.layer.retire();
      await source.close();
      throw error;
    }
  }

  text(): string {
    return [
      `## Module: ${this.module.manifest.name}`,
      `Version: ${this.module.manifest.version}\nRevision: ${this.module.revision}`,
      ...this.module.manifest.instructions.map((path) => moduleText(this.module, path)),
      ...this.mcp.instructions.map(
        ({ server, text }) => `### Server instructions: ${server}\n\n${text}`,
      ),
      "### Connections",
      ...this.mcp.statuses.map(
        (status) => `- ${status.id}: ${status.state}${status.error ? ` (${status.error})` : ""}`,
      ),
      "### Resources",
      ...this.module.manifest.resources.map((r) => `- ${r.id}: ${r.description}`),
      "### Tools",
      ...this.mcp.tools.map((tool) => `- ${tool.name}: ${tool.description}`),
    ].join("\n\n");
  }

  async use<T>(run: (generation: ModuleGeneration) => Promise<T>): Promise<T> {
    if (this.#retired) throw new Error("Module generation was retired");
    this.#users++;
    try {
      return await run(this);
    } finally {
      this.#users--;
      if (this.#retired) await this.retire();
    }
  }

  retire(): Promise<void> {
    this.#retired = true;
    if (this.#users > 0) return Promise.resolve();
    this.#closing ??= this.mcp.close().finally(this.cleanup);
    return this.#closing;
  }

  async call(name: string, args: Record<string, unknown>, context: ToolContext) {
    const original = this.mcp.tools.find((tool) => tool.name === name);
    if (!original) throw new Error(`Unknown module tool: ${name}. List tools again.`);
    const tool = this.module.manifest.runtime?.readOnlyTools?.includes(name)
      ? { ...original, mutating: false, permissionSafety: "read-only" as const }
      : original;
    if (!context.invokeTool)
      throw new Error("Module tools require the guarded agent execution path");
    return this.use(
      () =>
        context.invokeTool?.(tool, args, context) ??
        Promise.reject(new Error("Missing tool executor")),
    );
  }

  resource(id: string): string {
    const resource = this.module.manifest.resources.find((item) => item.id === id);
    if (!resource) throw new Error(`Unknown module resource: ${id}`);
    return moduleText(this.module, resource.path, 512_000);
  }

  surface(id: string) {
    const surface = this.module.manifest.surfaces.find((item) => item.id === id);
    if (!surface) throw new Error(`Unknown module surface: ${id}`);
    return {
      ...surface,
      html: moduleText(this.module, surface.entry, MODULE_SURFACE_BYTES),
      root: join(this.root, surface.entry),
    };
  }
}

function moduleDirectory(root: string, path: string): string {
  const target = resolve(root, path);
  const local = relative(root, target);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error("Module path escapes its directory");
  return target;
}
