import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { harnessServices } from "../core/services/contracts";
import { defineService, ServiceLayer, type Services } from "../core/services/registry";
import { abortable } from "../util/abort";
import type { ModulePackage } from "./package";
import type { ModulePlatformSetup } from "./platform-sdk";

export class ModulePlatform {
  readonly controller = new AbortController();
  readonly effects: Array<() => void | Promise<void>> = [];
  readonly layer: ServiceLayer;
  #closed = false;
  constructor(
    readonly owner: string,
    report?: (owner: string, error: unknown) => void,
  ) {
    this.layer = new ServiceLayer(
      owner,
      async () => {
        this.#closed = true;
        this.controller.abort(new Error(`Module ${owner} unloaded`));
        const errors: unknown[] = [];
        for (const dispose of this.effects.reverse()) {
          try {
            await dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, `Module ${owner} cleanup failed`);
      },
      (error) => report?.(owner, error),
    );
  }
  static async open(
    module: ModulePackage,
    root: string,
    workspace: string,
    sessionId: string | undefined,
    services: Services,
    signal: AbortSignal,
    report?: (owner: string, error: unknown) => void,
  ): Promise<ModulePlatform | undefined> {
    if (!module.manifest.platform) return undefined;
    const instance = new ModulePlatform(module.manifest.name, report);
    try {
      // ponytail: Bun retains imported JS until restart; use a worker-backed service for large, frequently reloaded implementations.
      const loaded = (await import(
        pathToFileURL(join(root, module.manifest.platform.entry)).href
      )) as { default?: unknown };
      if (typeof loaded.default !== "function")
        throw new Error("platform.entry must default-export a setup function");
      const setup = (loaded.default as ModulePlatformSetup)({
        apiVersion: 1,
        workspace,
        moduleRoot: root,
        sessionId,
        signal: instance.controller.signal,
        z,
        contracts: harnessServices,
        defineService,
        services: {
          provide: instance.layer.provide.bind(instance.layer),
          replace: instance.layer.replace.bind(instance.layer),
          wrap: instance.layer.wrap.bind(instance.layer),
          require(contract) {
            instance.layer.requirements.set(contract.id, contract.signature);
            return (...args) => services.invoke(contract, undefined, ...args);
          },
        },
        async effect(setup) {
          instance.controller.signal.throwIfAborted();
          const cleanup = await setup();
          if (!cleanup) return;
          if (instance.#closed) await cleanup();
          else instance.effects.push(cleanup);
        },
      });
      await abortable(Promise.resolve(setup), signal);
      signal.throwIfAborted();
      instance.layer.seal();
      return instance;
    } catch (error) {
      await instance.layer.retire();
      throw error;
    }
  }
}
