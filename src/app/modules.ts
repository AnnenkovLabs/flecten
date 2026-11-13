import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { MarketplaceActionSchema } from "../../shared/module-marketplace";
import { ModuleChangeSchema } from "../../shared/modules";
import { ModulesConfigSchema } from "../config/modules";
import type { HarnessConfig } from "../config/schema";
import { ModuleCatalog } from "../modules/catalog";
import { ModuleMarketplace } from "../modules/marketplace";
import { installModule, publishModule, readModule } from "../modules/package";
import { ModuleRuntime } from "../modules/runtime";
import { Mutex } from "../util/mutex";
import type { ExtensionRuntime } from "./extension-runtime";
import { requestProjectTrust } from "./project-trust";

export function moduleService(
  cwd: string,
  config: () => HarnessConfig,
  trusted: () => boolean,
  commit: (next: HarnessConfig) => Promise<unknown>,
  extensions: Pick<ExtensionRuntime, "options" | "registerRuntime">,
  acceptTrust: () => Promise<unknown>,
) {
  const catalog = new ModuleCatalog(cwd, () => config().modules);
  const marketplace = new ModuleMarketplace();
  const mutations = new Mutex();
  const runtime = new ModuleRuntime(catalog, trusted, {
    ...extensions.options,
    registerRuntime: extensions.registerRuntime,
    requestTrust: (context) => requestProjectTrust(context, trusted, acceptTrust),
  });
  return {
    runtime,
    marketplace(raw: unknown) {
      const input = MarketplaceActionSchema.parse(raw);
      return mutations.run(async () => {
        const next = structuredClone(config());
        const section = ModulesConfigSchema.parse(next.modules ?? {});
        next.modules = section;
        const created: string[] = [];
        try {
          if (input.action === "addSource") {
            await marketplace.validateSource(input.url);
            section.marketplaces = [...new Set([...section.marketplaces, input.url])];
          } else if (input.action === "removeSource") {
            section.marketplaces = section.marketplaces.filter((url) => url !== input.url);
          } else if (input.action === "install") {
            await catalog.refresh(true);
            const available = await marketplace.list(section.marketplaces);
            if (
              !available.entries.some(
                (entry) => entry.source === input.source && entry.name === input.name,
              )
            )
              throw new Error("Module is unavailable. Reload the marketplace.");
            const packages = await marketplace.packages(
              input.source,
              input.name,
              input.revision,
              new Set(catalog.modules.keys()),
            );
            for (const module of packages) {
              const path = await publishModule(cwd, module);
              created.push(path);
              section.dirs.push(path);
            }
          }
          if (input.action !== "list") await commit(next);
        } catch (error) {
          for (const path of created) await rm(path, { recursive: true, force: true });
          throw error;
        }
        await catalog.refresh(true);
        return {
          moduleMarketplace: await marketplace.list(
            section.marketplaces,
            input.action === "list" && input.refresh,
          ),
          moduleState: await runtime.state(),
        };
      });
    },
    state: (sessionId?: string) => runtime.state(sessionId),
    surface: (sessionId: string, name: string, id: string, revision: string) =>
      runtime.surface(sessionId, name, id, revision),
    styles: (name: string, revision: string) => runtime.interfaceStyles(name, revision),
    authorize: (sessionId: string, name: string, id: string, revision: string, request: unknown) =>
      runtime.authorizeSurface(sessionId, name, id, revision, request),
    change(raw: unknown) {
      return mutations.run(async () => {
        const input = ModuleChangeSchema.parse(raw);
        const next = structuredClone(config());
        const section = ModulesConfigSchema.parse(next.modules ?? {});
        next.modules = section;
        if (input.operation === "install") {
          const path = await installModule(cwd, input.path);
          if (!section.dirs.includes(path)) section.dirs.push(path);
        } else {
          const path = resolve(cwd, input.path);
          await catalog.refresh(true);
          const installed = [...catalog.modules.values()].find((module) => module.path === path);
          if (input.operation === "remove") {
            section.dirs = section.dirs.filter((dir) => resolve(cwd, dir) !== path);
            section.disabled = [...new Set([...section.disabled, path])];
            section.development = section.development.filter((dir) => dir !== path);
            delete section.trusted[path];
            section.interfaces = section.interfaces.filter((dir) => dir !== path);
          } else {
            if (!installed) throw new Error("Module is not installed or has an invalid manifest");
            const current = await readModule(path);
            if (input.operation === "trust") {
              if (current.revision !== input.revision)
                throw new Error("Module changed. Review its current revision.");
              section.trusted[path] = current.revision;
            } else if (input.operation === "development") {
              if (input.enabled && !installed.view.trusted)
                throw new Error("Trust the current module before enabling development reload");
              section.development = section.development.filter((dir) => dir !== path);
              if (input.enabled) section.development.push(path);
              else if (installed.view.development) section.trusted[path] = current.revision;
            } else if (input.operation === "interface") {
              if (input.enabled && !installed.view.enabled)
                throw new Error("Enable and trust the module before using its interface");
              section.interfaces = section.interfaces.filter((dir) => dir !== path);
              if (input.enabled) section.interfaces.push(path);
            } else {
              if (input.enabled && !installed.view.trusted)
                throw new Error("Trust the module before enabling it");
              section.disabled = section.disabled.filter((dir) => dir !== path);
              if (!input.enabled) section.disabled.push(path);
              if (input.enabled) section.enabled = true;
            }
          }
        }
        await commit(next);
        await catalog.refresh(true);
        return runtime.state();
      });
    },
    dispose: () => runtime.dispose(),
  };
}
