import { readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { assertNoActiveCore } from "./active-core";
import {
  digest,
  durableRename,
  durableWrite,
  EntrySchema,
  info,
  manifest,
  readJson,
  sameManifest,
} from "./fs";
import {
  AcceptedSchema,
  aliasCurrent,
  layout,
  paths,
  readAcceptance,
  relocationSource,
  sameStoragePath,
} from "./state";

const RelocationSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  previousAcceptance: AcceptedSchema,
  entries: z.array(EntrySchema),
});

function relocationPaths(root: string, source: string) {
  const key = digest(Buffer.from(JSON.stringify([source, root])));
  return {
    proof: join(paths(root).transaction, `relocation-${key}.json`),
    alias: join(paths(root).transaction, `relocation-${key}-legacy`),
  };
}

async function readProof(root: string, source: string) {
  const raw = await readJson(relocationPaths(root, source).proof);
  if (raw === undefined) return undefined;
  const proof = RelocationSchema.parse(raw);
  const previous = await readAcceptance(root);
  if (
    proof.root !== root ||
    proof.previousAcceptance.root !== source ||
    proof.previousAcceptance.acceptedAt !== previous?.acceptedAt
  )
    throw new Error("Relocation verification belongs to a different storage location");
  return proof;
}

/** Replace only the exact former canonical alias; never follow or alter another target. */
async function relocateAlias(root: string, source: string): Promise<void> {
  const p = paths(root);
  const current = await info(p.current);
  if (!current?.isDirectory() || current.isSymbolicLink())
    throw new Error(`Relocated storage must remain a regular directory at ${p.current}`);
  const legacy = await info(p.legacy);
  if (!legacy) return aliasCurrent(root);
  if (!legacy.isSymbolicLink())
    throw new Error(`Independent legacy storage remains at ${p.legacy}. Preserve both stores.`);
  const target = resolve(root, await readlink(p.legacy));
  if (sameStoragePath(target, p.current)) return;
  if (!sameStoragePath(target, paths(source).current))
    throw new Error(`Unsafe legacy alias at ${p.legacy}. It does not match the accepted storage.`);
  const archived = relocationPaths(root, source).alias;
  if (await info(archived))
    throw new Error(`Preserve the previous compatibility alias at ${archived} before retrying.`);
  await durableRename(p.legacy, archived);
  await aliasCurrent(root);
}

/** A moved accepted store is never accepted automatically, even when its data is unchanged. */
export async function prepareRelocation(root: string): Promise<boolean> {
  const source = await relocationSource(root);
  if (!source) return false;
  await assertNoActiveCore(root);
  await relocateAlias(root, source);
  const previous = await readAcceptance(root);
  const proof = await readProof(root, source);
  const entries = await manifest(paths(root).current, "durable");
  if (proof) {
    if (!sameManifest(entries, proof.entries))
      throw new Error(`Relocated storage changed after verification at ${root}. Preserve it.`);
  } else {
    await durableWrite(
      relocationPaths(root, source).proof,
      `${JSON.stringify(RelocationSchema.parse({ version: 1, root, previousAcceptance: previous, entries }))}\n`,
    );
  }
  return true;
}

export async function interruptedRelocation(root: string): Promise<boolean> {
  const source = await relocationSource(root);
  return !!source && !!(await readProof(root, source));
}

/** Acceptance rechecks the exact snapshot; historical backups and transactions stay untouched. */
export async function verifyRelocation(root: string): Promise<boolean> {
  const source = await relocationSource(root);
  if (!source) return false;
  const proof = await readProof(root, source);
  if (!proof)
    throw new Error(`Verify relocated storage before accepting its new location: ${root}`);
  const stores = await layout(root);
  if (!stores.current || !stores.alias)
    throw new Error(`Relocated storage layout changed at ${root}. Preserve both stores.`);
  if (!sameManifest(await manifest(paths(root).current, "durable"), proof.entries))
    throw new Error(`Relocated storage changed after verification at ${root}. Preserve it.`);
  return true;
}
