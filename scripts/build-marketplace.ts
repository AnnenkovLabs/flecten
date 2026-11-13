import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLECTEN_MARKETPLACE_URL } from "../shared/module-marketplace";
import { BUNDLED_MODULES } from "../src/modules/marketplace";
import { readModule } from "../src/modules/package";

const root = join(import.meta.dir, "../src/marketplace");

await rm(join(root, "packages"), { recursive: true, force: true });
await mkdir(join(root, "packages"), { recursive: true });
const modules = await Promise.all(
  BUNDLED_MODULES.map(async (metadata) => {
    const module = await readModule(join(root, "modules", metadata.name));
    const files = Object.fromEntries(
      [...module.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]),
    );
    const packageUrl = new URL(`packages/${metadata.name}.json`, FLECTEN_MARKETPLACE_URL).href;
    await writeFile(
      join(root, "packages", `${metadata.name}.json`),
      `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`,
    );
    return {
      title: metadata.title,
      publisher: "Flecten",
      category: metadata.category,
      manifest: module.manifest,
      revision: module.revision,
      packageUrl,
    };
  }),
);
await writeFile(
  join(root, "index.json"),
  `${JSON.stringify({ schemaVersion: 1, name: "Flecten", modules }, null, 2)}\n`,
);
console.log(`published ${modules.length} modules to src/marketplace`);
