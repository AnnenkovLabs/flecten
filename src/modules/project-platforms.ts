import { harnessServices } from "../core/services/contracts";
import { type ServiceLayer, Services } from "../core/services/registry";
import { Mutex } from "../util/mutex";
import type { CatalogModule, ModuleCatalog } from "./catalog";
import { materializeModule } from "./package";
import { ModulePlatform } from "./platform";
import { resolveModules } from "./resolve";

interface ActivePlatform {
  revision: string;
  instance: ModulePlatform;
}
/** Project services exist before replay; task-local services never alter other chats. */
export class ProjectPlatforms {
  readonly #mutex = new Mutex();
  #active = new Map<string, ActivePlatform>();
  #failed = -1;
  #plan = new Map<string, CatalogModule>();
  error: string | undefined;
  readonly services = new Services(() =>
    [...this.#active]
      .filter(([name]) => this.trusted() && this.catalog.modules.get(name)?.view.enabled)
      .map(([, p]) => p.instance.layer),
  );
  constructor(
    readonly catalog: ModuleCatalog,
    readonly trusted: () => boolean,
    readonly report?: (owner: string, error: unknown) => void,
    readonly validateSessions?: (layers: readonly ServiceLayer[]) => void,
  ) {}
  async prepare(signal: AbortSignal): Promise<void> {
    await this.#mutex.run(async () => {
      await this.catalog.refresh();
      // Revocation always wins over retaining a failed development revision.
      for (const [name, value] of this.#active)
        if (!this.trusted() || !this.catalog.modules.get(name)?.view.enabled) {
          this.#active.delete(name);
          await value.instance.layer.retire();
        }
      if (!this.trusted() || this.#failed === this.catalog.revision) return;
      const roots = [...this.catalog.modules.values()]
        .filter((m) => m.view.enabled && m.manifest.platform?.scope === "project")
        .map((m) => m.manifest.name);
      const created: ModulePlatform[] = [];
      const next = new Map<string, ActivePlatform>();
      try {
        const plan = resolveModules(this.catalog, roots);
        for (const module of plan) {
          if (!module.manifest.platform) continue;
          if (module.manifest.platform.scope !== "project")
            throw new Error(
              `Project service cannot depend on session platform ${module.manifest.name}`,
            );
          let value = this.#active.get(module.manifest.name);
          if (value?.revision !== module.revision) {
            const source = await materializeModule(this.catalog.cwd, module);
            try {
              const instance = await ModulePlatform.open(
                module,
                source.root,
                this.catalog.cwd,
                undefined,
                this.services,
                signal,
                this.report,
              );
              if (!instance) throw new Error("Missing project platform");
              instance.effects.unshift(source.close);
              created.push(instance);
              value = { revision: module.revision, instance };
            } catch (error) {
              await source.close();
              throw error;
            }
          }
          if (value) next.set(module.manifest.name, value);
        }
        new Services(() => [...next.values()].map((p) => p.instance.layer)).validate(
          Object.values(harnessServices),
        );
        this.validateSessions?.([...next.values()].map((p) => p.instance.layer));
        signal.throwIfAborted();
        const previous = this.#active;
        this.#active = next;
        this.#plan = new Map(plan.map((m) => [m.manifest.name, m]));
        this.error = undefined;
        for (const [name, value] of previous)
          if (next.get(name) !== value) await value.instance.layer.retire();
      } catch (error) {
        for (const instance of created.reverse()) await instance.layer.retire();
        signal.throwIfAborted();
        this.#failed = this.catalog.revision;
        this.error = error instanceof Error ? error.message : String(error);
        const safe = new Map(
          [...this.#plan].filter(([name, old]) => {
            const current = this.catalog.modules.get(name);
            return (
              current?.view.enabled &&
              (current.view.development || current.revision === old.revision)
            );
          }),
        );
        const retained: string[] = [];
        for (const name of this.#active.keys()) {
          try {
            resolveModules({ modules: safe, config: this.catalog.config }, [...retained, name]);
            retained.push(name);
          } catch {
            /* A dependency was revoked or became incompatible. */
          }
        }
        const keep = new Set(
          resolveModules({ modules: safe, config: this.catalog.config }, retained).map(
            (m) => m.manifest.name,
          ),
        );
        for (const [name, value] of [...this.#active].reverse())
          if (!keep.has(name)) {
            this.#active.delete(name);
            await value.instance.layer.retire();
          }
      }
    }, signal);
  }
  async close(): Promise<void> {
    await this.#mutex.run(async () => {
      for (const p of [...this.#active.values()].reverse()) await p.instance.layer.retire();
      this.#active.clear();
    });
  }
}
