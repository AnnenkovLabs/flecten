import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  FLECTEN_MARKETPLACE_URL,
  MarketplaceCategorySchema,
  type MarketplaceEntry,
  type MarketplaceState,
  MarketplaceUrlSchema,
  ModuleRevisionSchema,
} from "../../shared/module-marketplace";
import { type ModuleManifest, ModuleManifestSchema } from "./manifest";
import { downloadMarketplaceModule, marketplaceJson } from "./marketplace-download";
import { type ModulePackage, readModule } from "./package";

const MetadataSchema = z.object({
  title: z.string().min(1).max(100),
  publisher: z.string().min(1).max(100),
  category: MarketplaceCategorySchema,
});
const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(100),
    modules: z
      .array(
        MetadataSchema.extend({
          manifest: ModuleManifestSchema,
          revision: ModuleRevisionSchema,
          packageUrl: MarketplaceUrlSchema,
        }).strict(),
      )
      .max(200),
  })
  .strict();

export const BUNDLED_MODULES = [
  { name: "computer-use", title: "Computer", category: "workflow" },
  { name: "better-trailer", title: "Trailer timeline", category: "workflow" },
  { name: "studio-harness", title: "Studio harness", category: "interface" },
  { name: "frame-workflow", title: "Frame workflow", category: "workflow" },
  { name: "frame-service", title: "Frame service", category: "platform" },
  { name: "sqlite-journal", title: "SQLite journal", category: "platform" },
] as const;
type Listing = {
  entry: MarketplaceEntry;
  manifest: ModuleManifest;
} & ({ folder: string; packageUrl?: never } | { packageUrl: string; folder?: never });

function entry(
  source: string,
  metadata: z.infer<typeof MetadataSchema>,
  manifest: ModuleManifest,
  revision: string,
): MarketplaceEntry {
  return {
    source,
    ...metadata,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    revision,
    requires: manifest.requires,
    capabilities: manifest.capabilities,
    native: Boolean(
      manifest.runtime ||
        manifest.platform ||
        Object.keys(manifest.mcp.servers).length ||
        Object.values(manifest.hooks).some((hooks) => hooks.length),
    ),
    interface: Boolean(
      manifest.styles.length || manifest.surfaces.some((surface) => surface.placement),
    ),
    ...(manifest.platform ? { platformScope: manifest.platform.scope } : {}),
  };
}

export class ModuleMarketplace {
  #catalogs = new Map<string, { name: string; listings: Listing[] }>();

  async #load(source: string): Promise<{ name: string; listings: Listing[] }> {
    if (source === "bundled") {
      // The repository catalog is the live source once the repo is public; local files keep
      // the marketplace usable offline and while the repository is still private.
      try {
        return await this.#catalog("bundled", FLECTEN_MARKETPLACE_URL, 5_000);
      } catch {
        return await this.#bundledFiles();
      }
    }
    return await this.#catalog(source, source, 15_000);
  }

  async #catalog(
    source: string,
    url: string,
    timeoutMs: number,
  ): Promise<{ name: string; listings: Listing[] }> {
    const catalog = CatalogSchema.parse(await marketplaceJson(url, 2 * 1024 * 1024, timeoutMs));
    const names = catalog.modules.map((module) => module.manifest.name);
    if (new Set(names).size !== names.length)
      throw new Error("Duplicate module name in catalog. Ask the publisher to fix the catalog.");
    return {
      name: catalog.name,
      listings: catalog.modules.map((module) => ({
        entry: entry(source, MetadataSchema.parse(module), module.manifest, module.revision),
        manifest: module.manifest,
        packageUrl: module.packageUrl,
      })),
    };
  }

  async #bundledFiles(): Promise<{ name: string; listings: Listing[] }> {
    const root = [
      join(dirname(process.execPath), "module-marketplace"),
      join(import.meta.dir, "../marketplace/modules"),
    ].find((path) => existsSync(join(path, "better-trailer/.flecten-module/module.json")));
    if (!root) throw new Error("Bundled modules are missing. Rebuild or reinstall Flecten.");
    const listings = await Promise.all(
      BUNDLED_MODULES.map(async (metadata) => {
        const folder = join(root, metadata.name);
        const module = await readModule(folder);
        return {
          entry: entry(
            "bundled",
            { ...metadata, publisher: "Flecten" },
            module.manifest,
            module.revision,
          ),
          manifest: module.manifest,
          folder,
        };
      }),
    );
    return { name: "Flecten", listings };
  }

  async validateSource(source: string): Promise<void> {
    this.#catalogs.set(source, await this.#load(source));
  }

  async list(urls: string[], refresh = false): Promise<MarketplaceState> {
    const sources = ["bundled", ...new Set(urls)];
    const state: MarketplaceState = { sources: [], entries: [], errors: [] };
    const results = await Promise.allSettled(
      sources.map(async (source) => {
        const cached = this.#catalogs.get(source);
        if (!refresh && cached) return cached;
        const loaded = await this.#load(source);
        this.#catalogs.set(source, loaded);
        return loaded;
      }),
    );
    for (const [index, result] of results.entries()) {
      const source = sources[index];
      if (!source) continue;
      if (result.status === "fulfilled") {
        state.sources.push({ id: source, name: result.value.name, bundled: source === "bundled" });
        state.entries.push(...result.value.listings.map((listing) => listing.entry));
      } else {
        this.#catalogs.delete(source);
        state.sources.push({ id: source, name: source, bundled: false });
        state.errors.push({
          source,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
    for (const source of this.#catalogs.keys())
      if (!sources.includes(source)) this.#catalogs.delete(source);
    return state;
  }

  /** Resolve only declared dependencies from the selected catalog; validate all bytes before publishing any. */
  async packages(
    source: string,
    name: string,
    revision: string,
    installed: Set<string>,
  ): Promise<ModulePackage[]> {
    const catalog = this.#catalogs.get(source);
    if (!catalog) throw new Error("Reload the marketplace before installing a module.");
    const listings = new Map(catalog.listings.map((listing) => [listing.entry.name, listing]));
    const selected = listings.get(name);
    if (!selected || selected.entry.revision !== revision)
      throw new Error("Catalog changed. Reload and review this module again.");
    if (installed.has(name))
      throw new Error("Module is already installed. Manage it in Installed.");
    const ordered = new Map<string, Listing>();
    const visiting = new Set<string>();
    function visit(id: string): void {
      if (visiting.has(id))
        throw new Error("Module dependency cycle. Ask the publisher to fix the catalog.");
      if (installed.has(id) || ordered.has(id)) return;
      const listing = listings.get(id);
      if (!listing)
        throw new Error(`Missing dependency: ${id}. Add its catalog or install it from a folder.`);
      visiting.add(id);
      for (const dependency of listing.manifest.requires) visit(dependency);
      visiting.delete(id);
      ordered.set(id, listing);
    }
    visit(name);
    if (ordered.size > 32)
      throw new Error("Install at most 32 modules at once. Install dependencies separately.");
    const packages: ModulePackage[] = [];
    let totalBytes = 0;
    for (const listing of ordered.values()) {
      const module =
        listing.folder !== undefined
          ? await readModule(listing.folder)
          : await downloadMarketplaceModule(listing.packageUrl);
      for (const bytes of module.files.values()) totalBytes += bytes.byteLength;
      if (totalBytes > 128 * 1024 * 1024)
        throw new Error("Installation exceeds 128 MiB. Install dependencies separately.");
      if (
        module.revision !== listing.entry.revision ||
        JSON.stringify(module.manifest) !== JSON.stringify(listing.manifest)
      )
        throw new Error(
          "Package does not match the reviewed catalog version. Reload the catalog or contact its publisher.",
        );
      packages.push(module);
    }
    return packages;
  }
}
