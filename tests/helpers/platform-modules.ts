import { join } from "node:path";
import { readModule } from "../../src/modules/package";
import type { moduleFixture } from "./modules";

export type PlatformFixture = Awaited<ReturnType<typeof moduleFixture>>;
export async function platform(
  f: PlatformFixture,
  code: string,
  scope: "project" | "session" = "session",
) {
  const { runtime: _runtime, ...manifest } = f.manifest;
  await Bun.write(join(f.root, "platform.mjs"), code);
  await Bun.write(
    join(f.root, ".flecten-module/module.json"),
    JSON.stringify({ ...manifest, hooks: {}, platform: { entry: "platform.mjs", scope } }),
  );
  await f.app.modules.runtime.catalog.refresh(true);
  await f.app.modules.change({
    operation: "trust",
    path: f.root,
    revision: (await readModule(f.root)).revision,
  });
}
export async function installExample(f: PlatformFixture, name: string) {
  await f.app.modules.change({
    operation: "install",
    path: join(import.meta.dirname, "../../src/marketplace/modules", name),
  });
  const module = (await f.app.modules.state()).modules.find((m) => m.name === name);
  if (!module) throw new Error(`Missing example ${name}`);
  await f.app.modules.change({ operation: "trust", path: module.path, revision: module.revision });
  return module;
}
