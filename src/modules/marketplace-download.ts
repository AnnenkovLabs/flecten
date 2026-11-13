import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { MarketplaceUrlSchema } from "../../shared/module-marketplace";
import { ModuleResourcePathSchema } from "./manifest";
import { type ModulePackage, readModule } from "./package";

/** No redirects: a reviewed catalog cannot silently select another download origin. */
export async function marketplaceJson(
  url: string,
  limit: number,
  timeoutMs = 15_000,
): Promise<unknown> {
  MarketplaceUrlSchema.parse(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!response.ok)
    throw new Error(`Catalog request failed (${response.status}). Retry or check the catalog URL.`);
  if (!response.body) throw new Error("Empty catalog response. Check the catalog URL.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new Error(
          "Marketplace response exceeds its size limit. Ask the publisher for a smaller package.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const BundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    files: z.record(ModuleResourcePathSchema, z.string().max(45 * 1024 * 1024)),
  })
  .strict();

export async function downloadMarketplaceModule(url: string): Promise<ModulePackage> {
  const bundle = BundleSchema.parse(await marketplaceJson(url, 45 * 1024 * 1024));
  const entries = Object.entries(bundle.files);
  if (entries.length > 5000) throw new Error("Module exceeds 5000 files");
  const root = await mkdtemp(join(tmpdir(), "flecten-marketplace-"));
  let size = 0;
  try {
    for (const [path, encoded] of entries) {
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded) throw new Error("Package contains invalid base64");
      size += bytes.byteLength;
      if (size > 32 * 1024 * 1024) throw new Error("Module exceeds 32 MiB");
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return await readModule(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
