import { rm } from "node:fs/promises";
import { join } from "node:path";
import { assertNoActiveCore } from "./active-core";
import {
  copyEntries,
  durableRename,
  ensureDirectory,
  info,
  manifest,
  sameManifest,
  syncDirectory,
} from "./fs";
import { layout, paths, type Transaction } from "./state";

export async function validPublished(state: Transaction): Promise<void> {
  const p = paths(state.root, state.revision);
  if (!state.merged || !sameManifest(await manifest(p.current), state.merged))
    throw new Error(
      `Published storage failed hash verification at ${p.current}. Originals remain in ${p.originals}.`,
    );
  if (!(await layout(state.root)).alias)
    throw new Error(`Compatibility alias is missing at ${p.legacy}. Retry migration.`);
}

export async function retireSources(state: Transaction): Promise<void> {
  const p = paths(state.root, state.revision);
  await assertNoActiveCore(state.root);
  for (const source of state.sources) {
    const original = p[source.name];
    const retired = join(p.transaction, `retired-${source.name}`);
    const originalPresent = await info(original);
    if (await info(retired)) {
      if (originalPresent)
        throw new Error(
          `Storage changed during migration at ${original}. Originals: ${p.originals}`,
        );
      if (sameManifest(await manifest(retired, source.scope), source.entries)) continue;
      if (source.scope === "durable")
        throw new Error(
          `Retired storage changed at ${retired}. Preserve its rebuildable originals and review ${p.originals} before retrying.`,
        );
      await rm(retired, { recursive: true, force: true });
    }
    if (!originalPresent) {
      // A lost rename destination can be reconstructed from the already verified backup.
      await ensureDirectory(retired);
      await copyEntries(join(p.originals, source.name), retired, source.entries);
      if (!sameManifest(await manifest(retired, source.scope), source.entries))
        throw new Error(`Retired storage verification failed at ${retired}`);
      continue;
    }
    if (!sameManifest(await manifest(original, source.scope), source.entries))
      throw new Error(
        `Storage changed since backup at ${original}. Close other app versions. Originals: ${p.originals}`,
      );
    await durableRename(original, retired);
  }
  if (state.alias && (await info(p.legacy))) {
    // The target may now be temporarily absent; inspect the link itself without following it.
    const link = await info(p.legacy);
    if (!link?.isSymbolicLink())
      throw new Error(`Storage alias changed at ${p.legacy}. Originals: ${p.originals}`);
    await rm(p.legacy);
    await syncDirectory(state.root);
  }
}
