import type { CatalogModule, ModuleCatalog } from "./catalog";

/** Explicit dependency graph, no text matching or task classifier in the host. */
export function resolveModules(
  catalog: Pick<ModuleCatalog, "modules" | "config">,
  roots: readonly string[],
): CatalogModule[] {
  const ordered = new Map<string, CatalogModule>();
  const visiting = new Set<string>();
  function visit(name: string): void {
    if (visiting.has(name))
      throw new Error(`Module dependency cycle: ${[...visiting, name].join(" -> ")}`);
    if (ordered.has(name)) return;
    const module = catalog.modules.get(name);
    if (!module?.view.enabled)
      throw new Error(`Module ${name} is unavailable, disabled or needs trust review`);
    visiting.add(name);
    for (const dependency of module.manifest.requires) visit(dependency);
    visiting.delete(name);
    ordered.set(name, module);
  }
  for (const root of roots) visit(root);
  if (ordered.size > catalog.config.maxActive)
    throw new Error(`At most ${catalog.config.maxActive} active modules per session`);
  for (const module of ordered.values()) {
    for (const conflict of module.manifest.conflicts) {
      if (ordered.has(conflict))
        throw new Error(`Module conflict: ${module.manifest.name} and ${conflict}`);
    }
  }
  return [...ordered.values()];
}
