import { existsSync, type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ModuleView } from "../../shared/modules";
import { type ModulesConfig, ModulesConfigSchema } from "../config/modules";
import { Mutex } from "../util/mutex";
import { type ModulePackage, readModule } from "./package";

export interface CatalogModule extends ModulePackage {
  view: ModuleView;
}

/** Watching changes only the catalog. Running sessions adopt a generation at a turn boundary. */
export class ModuleCatalog {
  readonly #mutex = new Mutex();
  readonly #watchers: FSWatcher[] = [];
  readonly #timer: ReturnType<typeof setInterval>;
  #dirty = true;
  #signature = "";
  #closed = false;
  revision = 0;
  modules = new Map<string, CatalogModule>();
  errors: Array<{ path: string; message: string }> = [];

  constructor(
    readonly cwd: string,
    readonly configuration: () => ModulesConfig | undefined,
  ) {
    // ponytail: periodic rescan recovers dropped OS watch events; use a metadata index for very large catalogs.
    this.#timer = setInterval(() => {
      this.#dirty = true;
    }, 10_000);
    this.#timer.unref?.();
  }

  get config(): ModulesConfig {
    return ModulesConfigSchema.parse(this.configuration() ?? {});
  }

  refresh(force = false): Promise<void> {
    return this.#mutex.run(async () => {
      if (this.#closed) throw new Error("Module catalog is closed");
      const config = this.config;
      const signature = JSON.stringify(config);
      if (!force && !this.#dirty && signature === this.#signature) return;
      this.#dirty = false;
      this.#signature = signature;
      const paths = new Set(config.dirs.map((path) => resolve(this.cwd, path)));
      const errors: typeof this.errors = [];
      for (const directory of config.roots) {
        const root = resolve(this.cwd, directory);
        try {
          for (const entry of await readdir(root, { withFileTypes: true })) {
            if (entry.isDirectory()) paths.add(join(root, entry.name));
            else if (entry.isSymbolicLink())
              errors.push({
                path: join(root, entry.name),
                message: "Symlink module directories are not supported",
              });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            errors.push({ path: root, message: String(error) });
        }
      }
      const modules = new Map<string, CatalogModule>();
      const collisions = new Set<string>();
      for (const path of [...paths].sort()) {
        try {
          const module = await readModule(path);
          const { manifest } = module;
          const development = config.development.includes(path);
          const trusted = development || config.trusted[path] === module.revision;
          const enabled = config.enabled && trusted && !config.disabled.includes(path);
          const view: ModuleView = {
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            capabilities: manifest.capabilities,
            path,
            revision: module.revision,
            trusted,
            enabled,
            development,
            interfaceEnabled: config.interfaces.includes(path),
            requires: manifest.requires,
            ...(manifest.platform ? { platformScope: manifest.platform.scope } : {}),
            contributions: {
              instructions: manifest.instructions.length,
              resources: manifest.resources.length,
              servers: Object.keys(manifest.mcp.servers).length + (manifest.runtime ? 1 : 0),
              hooks: Object.values(manifest.hooks).reduce((sum, hooks) => sum + hooks.length, 0),
              surfaces: manifest.surfaces.length,
              styles: manifest.styles.length,
            },
          };
          if (modules.has(manifest.name) || collisions.has(manifest.name)) {
            collisions.add(manifest.name);
            modules.delete(manifest.name);
            throw new Error(`Duplicate module name: ${manifest.name}`);
          }
          modules.set(manifest.name, { ...module, view });
        } catch (error) {
          errors.push({ path, message: error instanceof Error ? error.message : String(error) });
        }
      }
      const fingerprint = (items: Map<string, CatalogModule>) =>
        JSON.stringify([...items.values()].map((m) => m.view));
      if (
        fingerprint(modules) !== fingerprint(this.modules) ||
        JSON.stringify(errors) !== JSON.stringify(this.errors)
      )
        this.revision++;
      this.modules = modules;
      this.errors = errors;
      this.#watch([...paths, ...config.roots.map((path) => resolve(this.cwd, path))]);
    });
  }

  #watch(paths: string[]): void {
    for (const watcher of this.#watchers.splice(0)) watcher.close();
    for (const path of new Set(paths)) {
      let target = path;
      while (!existsSync(target) && dirname(target) !== target) target = dirname(target);
      try {
        const watcher = watch(target, { recursive: target === path }, (_event, filename) => {
          if (
            target === path ||
            !filename ||
            filename.toString() === basename(relativeChild(target, path))
          )
            this.#dirty = true;
        });
        watcher.on("error", () => {
          this.#dirty = true;
        });
        watcher.unref();
        this.#watchers.push(watcher);
      } catch {
        // The bounded periodic rescan also supports filesystems without watchers.
      }
    }
  }

  close(): void {
    this.#closed = true;
    clearInterval(this.#timer);
    for (const watcher of this.#watchers.splice(0)) watcher.close();
  }
}

function relativeChild(parent: string, path: string): string {
  let child = path;
  while (dirname(child) !== parent && dirname(child) !== child) child = dirname(child);
  return child;
}
