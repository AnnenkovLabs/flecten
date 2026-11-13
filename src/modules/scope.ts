import activeInstructions from "../../prompts/modules-active.md" with { type: "text" };
import type { ModuleReference } from "../../shared/modules";
import type { HooksConfig } from "../core/hooks/types";
import type { ModuleDelivery } from "../core/modules/types";
import { harnessServices } from "../core/services/contracts";
import { Services } from "../core/services/registry";
import type { Message } from "../core/types";
import { Mutex } from "../util/mutex";
import type { ModuleCatalog } from "./catalog";
import { ModuleGeneration, type ModuleRuntimeOptions } from "./generation";
import { resolveModules } from "./resolve";
import { loadModuleState, saveModuleState } from "./session-state";

export class ModuleScope {
  readonly #mutex = new Mutex();
  #initialized = false;
  #closed = false;
  #requested: string[] = [];
  #active = new Map<string, ModuleGeneration>();
  #warning = "";
  #reportedWarning = "";
  #failedRevision = -1;

  constructor(
    readonly catalog: ModuleCatalog,
    readonly sessionId: string,
    readonly options: ModuleRuntimeOptions,
  ) {}

  get references(): ModuleReference[] {
    return [...this.#active].map(([name, generation]) => ({
      name,
      revision: generation.module.revision,
      requested: this.#requested.includes(name),
      contextRevision: new Bun.CryptoHasher("sha256").update(generation.text()).digest("hex"),
    }));
  }
  get generations(): readonly ModuleGeneration[] {
    return [...this.#active.values()];
  }
  get hooks(): HooksConfig {
    const hooks: HooksConfig = {};
    for (const generation of this.#active.values()) {
      if (!this.catalog.modules.get(generation.module.manifest.name)?.view.enabled) continue;
      for (const [event, entries] of Object.entries(generation.hooks)) {
        const key = event as keyof HooksConfig;
        hooks[key] = [...(hooks[key] ?? []), ...entries];
      }
    }
    return hooks;
  }
  require(name: string): ModuleGeneration {
    const generation = this.#active.get(name);
    if (!generation) throw new Error(`Module ${name} is not active in this session`);
    return generation;
  }

  prepare(history: readonly Message[], signal: AbortSignal): Promise<void> {
    return this.#mutex.run(async () => {
      if (this.#closed) throw new Error("Module session is closed");
      await this.catalog.refresh();
      if (!this.#initialized) {
        this.#requested = await loadModuleState(this.catalog.cwd, this.sessionId, history);
        this.#initialized = true;
      }
      if (this.#failedRevision === this.catalog.revision) return;
      const available: string[] = [];
      const warnings: string[] = [];
      for (const name of this.#requested) {
        try {
          resolveModules(this.catalog, [...available, name]);
          available.push(name);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : String(error));
        }
      }
      try {
        await this.#replace(available, signal);
      } catch (error) {
        signal.throwIfAborted();
        // Roll back only explicitly trusted development edits. Revocation still fails closed.
        const safe = new Map(
          [...this.#active]
            .filter(([name, generation]) => {
              const current = this.catalog.modules.get(name);
              return (
                current?.view.enabled &&
                (current.view.development || current.revision === generation.module.revision)
              );
            })
            .map(([name, generation]) => [name, generation.module]),
        );
        const retained: string[] = [];
        for (const name of available) {
          try {
            resolveModules({ modules: safe, config: this.catalog.config }, [...retained, name]);
            retained.push(name);
          } catch {
            /* The root or one of its dependencies no longer has a trusted generation. */
          }
        }
        const plan = resolveModules({ modules: safe, config: this.catalog.config }, retained);
        const keep = new Set(plan.map((module) => module.manifest.name));
        const removed = this.generations.filter(
          (generation) => !keep.has(generation.module.manifest.name),
        );
        this.#active = new Map([...this.#active].filter(([name]) => keep.has(name)));
        await Promise.all(removed.map((generation) => generation.retire()));
        this.#failedRevision = this.catalog.revision;
        warnings.push(error instanceof Error ? error.message : String(error));
      }
      this.#warning = warnings.join("\n");
    }, signal);
  }

  async change(name: string, enabled: boolean, signal: AbortSignal): Promise<ModuleDelivery> {
    await this.prepare([], signal);
    return this.#mutex.run(async () => {
      const requested = enabled
        ? [...new Set([...this.#requested, name])]
        : this.#requested.filter((item) => item !== name);
      if (!enabled && this.#active.has(name) && !this.#requested.includes(name))
        throw new Error(
          `Module ${name} is required by an active module. Deactivate its dependent module first.`,
        );
      await this.#replace(requested, signal, async () =>
        saveModuleState(this.catalog.cwd, this.sessionId, requested, signal),
      );
      this.#requested = requested;
      this.#warning = "";
      this.#failedRevision = -1;
      return this.delivery();
    }, signal);
  }

  delivery(): ModuleDelivery {
    const text = [
      activeInstructions.trim(),
      this.#warning ? `## Unavailable modules\n\n${this.#warning}` : "",
      ...this.generations.map((generation) => generation.text()),
    ]
      .filter(Boolean)
      .join("\n\n");
    return { text, references: this.references };
  }

  async beforeTurn(
    history: readonly Message[],
    signal: AbortSignal,
  ): Promise<ModuleDelivery | undefined> {
    await this.prepare(history, signal);
    const last = history.findLast(
      (message) => message.role !== "assistant" && message.moduleReferences !== undefined,
    );
    const references = last && last.role !== "assistant" ? last.moduleReferences : undefined;
    if (
      ((references !== undefined || this.#active.size > 0) &&
        JSON.stringify(references) !== JSON.stringify(this.references)) ||
      this.#reportedWarning !== this.#warning
    ) {
      this.#reportedWarning = this.#warning;
      return this.delivery();
    }
    return undefined;
  }

  async #replace(
    roots: string[],
    signal: AbortSignal,
    persist?: () => Promise<void>,
  ): Promise<void> {
    const plan = resolveModules(this.catalog, roots);
    const next = new Map<string, ModuleGeneration>();
    const created: ModuleGeneration[] = [];
    try {
      for (const module of plan) {
        signal.throwIfAborted();
        let generation = this.#active.get(module.manifest.name);
        if (generation?.module.revision !== module.revision) {
          generation = await ModuleGeneration.open(
            this.catalog.cwd,
            module,
            { ...this.options, sessionId: this.sessionId },
            signal,
          );
          created.push(generation);
        }
        if (generation) next.set(module.manifest.name, generation);
      }
      if (
        [...next.values()].some((g) =>
          g.platform?.layer.registrations.some((r) => r.contract.id === harnessServices.storage.id),
        )
      )
        throw new Error("Journal storage requires platform.scope project");
      new Services(() => [
        ...(this.options.services?.().layers() ?? []),
        ...[...next.values()].flatMap((g) => (g.platform ? [g.platform.layer] : [])),
      ]).validate(Object.values(harnessServices));
      const size =
        activeInstructions.length +
        [...next.values()].reduce((sum, generation) => sum + generation.text().length, 0);
      if (size > this.catalog.config.contextCharacters)
        throw new Error(
          `Module instructions exceed the ${this.catalog.config.contextCharacters} character session budget. Move detailed guides to resources.`,
        );
      signal.throwIfAborted();
      await persist?.();
      const previous = this.#active;
      this.#active = next;
      await Promise.all(
        [...previous]
          .filter(([name, generation]) => next.get(name) !== generation)
          .map(([, generation]) => generation.retire()),
      );
    } catch (error) {
      await Promise.all(created.map((generation) => generation.retire()));
      throw error;
    }
  }

  close(): Promise<void> {
    this.#closed = true;
    return this.#mutex.run(async () => {
      await Promise.all(this.generations.map((generation) => generation.retire()));
      this.#active.clear();
    });
  }
}
