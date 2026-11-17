import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { StorageMigrationState } from "../../../shared/storage-migration";
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
import { buildMerged } from "./merge";
import { retireSources, validPublished } from "./publication";
import { interruptedRelocation, prepareRelocation, verifyRelocation } from "./relocation";
import { replanCorrectedSources } from "./retry";
import {
  accepted,
  aliasCurrent,
  layout,
  markAccepted,
  normalizeRoots,
  paths,
  readTransaction,
  saveTransaction,
  type Transaction,
  withRootLock,
} from "./state";

export type MigrationProgress = (
  step: StorageMigrationState["step"],
  path: string,
  backups: readonly string[],
) => void;

/** A durable transaction is proof that the user already started this migration. */
export async function interruptedStorageMigration(roots: readonly string[]): Promise<boolean> {
  for (const root of await normalizeRoots(roots)) {
    if (
      !(await accepted(root)) &&
      ((await readTransaction(root)) || (await interruptedRelocation(root)))
    )
      return true;
  }
  return false;
}

/** Inspect without opening the core or its stores. Only roots with no prior data are initialized. */
export async function inspectStorageMigration(
  roots: readonly string[],
): Promise<{ required: boolean }> {
  let required = false;
  for (const root of await normalizeRoots(roots)) {
    if (await accepted(root)) {
      const stores = await layout(root);
      required ||= !stores.current || !stores.alias;
      continue;
    }
    const needsMigration = await withRootLock(root, async () => {
      const transaction = await readTransaction(root);
      let stores: Awaited<ReturnType<typeof layout>>;
      try {
        stores = await layout(root);
      } catch {
        return true;
      }
      if (await accepted(root)) return !stores.current || !stores.alias;
      if (transaction || stores.current || stores.legacy || stores.alias) return true;
      await ensureDirectory(paths(root).current);
      await aliasCurrent(root);
      await markAccepted(root);
      return false;
    });
    required ||= needsMigration;
  }
  return { required };
}

async function plan(root: string): Promise<Transaction> {
  const stores = await layout(root);
  const sources: Transaction["sources"] = [];
  const p = paths(root);
  if (stores.current)
    sources.push({
      name: "current",
      scope: "durable",
      entries: await manifest(p.current, "durable"),
    });
  if (stores.legacy)
    sources.push({
      name: "legacy",
      scope: "durable",
      entries: await manifest(p.legacy, "durable"),
    });
  return { version: 1, root, phase: "planned", alias: stores.alias, revision: 0, sources };
}

async function backupSources(state: Transaction): Promise<void> {
  const p = paths(state.root, state.revision);
  await ensureDirectory(p.originals);
  for (const source of state.sources) {
    const destination = join(p.originals, source.name);
    // Only an unfinished backup is recreated. Verified originals are never modified.
    await rm(destination, { recursive: true, force: true });
    await ensureDirectory(destination);
    const original = p[source.name];
    await copyEntries(original, destination, source.entries);
    if (!sameManifest(await manifest(destination, source.scope), source.entries))
      throw new Error(
        `Storage changed while backing up ${original}. Close other app versions and retry. Partial backup: ${destination}`,
      );
  }
  await syncDirectory(p.originals);
}

async function verifyBackups(state: Transaction): Promise<void> {
  for (const source of state.sources) {
    const location = join(paths(state.root, state.revision).originals, source.name);
    if (!sameManifest(await manifest(location, source.scope), source.entries))
      throw new Error(
        `Backup hash verification failed at ${location}. Original stores were preserved.`,
      );
  }
}

async function migrateRoot(
  root: string,
  progress: MigrationProgress,
  backups: string[],
): Promise<void> {
  const isAccepted = await accepted(root);
  if (isAccepted) {
    const stores = await layout(root);
    if (stores.current && stores.alias) return;
    throw new Error(
      `Storage changed after a previous accepted migration at ${root}. Preserve both stores and review ${paths(root).transaction} before retrying.`,
    );
  }
  await assertNoActiveCore(root);
  if (await prepareRelocation(root)) {
    progress("verify", root, [...backups]);
    return;
  }
  let state = await readTransaction(root);
  if (!state) {
    state = await plan(root);
    await saveTransaction(state);
  } else state = await replanCorrectedSources(state);
  const p = paths(root, state.revision);
  // These proofs live only for this locked invocation. Resume always verifies disk again.
  let backupsVerified = false;
  let stagingVerified = false;
  const ensureBackupsVerified = async () => {
    if (backupsVerified) return;
    await verifyBackups(state);
    backupsVerified = true;
  };
  if (state.sources.length && !backups.includes(p.originals)) backups.push(p.originals);
  const advance = async (phase: Transaction["phase"], step: StorageMigrationState["step"]) => {
    state.phase = phase;
    await saveTransaction(state);
    progress(step, root, [...backups]);
  };
  progress("inspect", root, [...backups]);
  if (state.phase === "planned") {
    progress("backup", root, [...backups]);
    await backupSources(state);
    backupsVerified = true;
    await advance("backed-up", "backup");
  }
  if (state.phase === "backed-up") {
    await ensureBackupsVerified();
    await rm(p.staging, { recursive: true, force: true });
    await ensureDirectory(p.staging);
    progress("merge", root, [...backups]);
    state.merged = await buildMerged(state);
    stagingVerified = true;
    await advance("merged", "merge");
  }
  if (state.phase === "merged") {
    await ensureBackupsVerified();
    if (
      !state.merged ||
      (!stagingVerified && !sameManifest(await manifest(p.staging), state.merged))
    )
      throw new Error(
        `Staging hash verification failed at ${p.staging}. Originals: ${p.originals}`,
      );
    await advance("verified", "verify");
  }
  if (state.phase === "verified") {
    await advance("retiring", "publish");
  }
  if (state.phase === "retiring") {
    await ensureBackupsVerified();
    await retireSources(state);
    await advance("retired", "publish");
  }
  if (state.phase === "retired") {
    if (!(await info(p.staging)) && !(await info(p.current))) {
      await ensureBackupsVerified();
      await ensureDirectory(p.staging);
      if (!state.merged || !sameManifest(await buildMerged(state), state.merged))
        throw new Error(
          `Restored staging failed verification at ${p.staging}. Originals: ${p.originals}`,
        );
    }
    if (await info(p.staging)) {
      if (await info(p.current))
        throw new Error(`Cannot publish over ${p.current}. Originals: ${p.originals}`);
      await durableRename(p.staging, p.current);
    } else if (!state.merged || !sameManifest(await manifest(p.current), state.merged)) {
      throw new Error(`Published storage is unavailable or changed. Originals: ${p.originals}`);
    }
    await advance("published", "publish");
  }
  if (state.phase === "published") {
    await aliasCurrent(root);
    // Rename publishes the already verified staging tree without changing its contents.
    if (!stagingVerified) await validPublished(state);
    await advance("ready", "publish");
  } else if (state.phase === "ready") {
    await validPublished(state);
    progress("publish", root, [...backups]);
  }
}

/** No completion marker is written until the separate acceptance command. */
export async function migrateStorageRoots(
  roots: readonly string[],
  progress: MigrationProgress,
): Promise<void> {
  const backups: string[] = [];
  for (const root of await normalizeRoots(roots)) {
    if (await accepted(root)) {
      const stores = await layout(root);
      if (stores.current && stores.alias) continue;
    }
    await withRootLock(root, () => migrateRoot(root, progress, backups));
  }
}

export async function acceptStorageMigration(roots: readonly string[]): Promise<void> {
  const normalized = await normalizeRoots(roots);
  const verified: string[] = [];
  // Keep every pending root locked from verification through all acceptance writes.
  // This retains the all-roots preflight without hashing each published tree twice.
  async function acceptNext(index: number): Promise<void> {
    const root = normalized[index];
    if (root === undefined) {
      for (const ready of verified) await assertNoActiveCore(ready);
      for (const ready of verified) await markAccepted(ready);
      return;
    }
    if (await accepted(root)) {
      const stores = await layout(root);
      if (stores.current && stores.alias) return acceptNext(index + 1);
      throw new Error(`Accepted storage changed at ${root}. Review ${paths(root).transaction}.`);
    }
    await withRootLock(root, async () => {
      if (await accepted(root)) {
        const stores = await layout(root);
        if (stores.current && stores.alias) return acceptNext(index + 1);
        throw new Error(`Accepted storage changed at ${root}. Review ${paths(root).transaction}.`);
      }
      await assertNoActiveCore(root);
      if (!(await verifyRelocation(root))) {
        const state = await readTransaction(root);
        if (state?.phase !== "ready")
          throw new Error(`Migration must finish before acceptance: ${root}`);
        await validPublished(state);
      }
      verified.push(root);
      await acceptNext(index + 1);
    });
  }
  await acceptNext(0);
}
