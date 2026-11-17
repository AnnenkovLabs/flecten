import { readlink, realpath, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { ContentScopeSchema } from "./content";
import { durableWrite, EntrySchema, ensureDirectory, info, readJson, syncDirectory } from "./fs";
import { withFileLock } from "./lock";

export const PhaseSchema = z.enum([
  "planned",
  "backed-up",
  "merged",
  "verified",
  "retiring",
  "retired",
  "published",
  "ready",
]);
export const SourceSchema = z.object({
  name: z.enum(["current", "legacy"]),
  scope: ContentScopeSchema.default("full"),
  entries: z.array(EntrySchema),
});
export const TransactionSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  phase: PhaseSchema,
  alias: z.boolean(),
  sources: z.array(SourceSchema),
  revision: z.number().int().nonnegative().max(1024).default(0),
  merged: z.array(EntrySchema).optional(),
});
export type Transaction = z.infer<typeof TransactionSchema>;
export type Source = z.infer<typeof SourceSchema>;
const AcceptedSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  acceptedAt: z.iso.datetime(),
});

export function paths(root: string, revision = 0) {
  const transaction = join(root, ".flecten-migration", "v1");
  return {
    root,
    transaction,
    current: join(root, ".flecten"),
    legacy: join(root, ".liquid"),
    originals: join(transaction, revision === 0 ? "originals" : `originals-${revision}`),
    staging: join(transaction, "staging"),
    state: join(transaction, "state.json"),
    accepted: join(transaction, "accepted.json"),
    lock: join(transaction, "engine.lock"),
  };
}

export async function normalizeRoots(roots: readonly string[]) {
  const result = new Set<string>();
  for (const root of roots) {
    if (!root || root.includes("\0")) throw new Error("Invalid storage root");
    if (!(await info(resolve(root)))) await ensureDirectory(resolve(root));
    result.add(await realpath(root));
  }
  return [...result];
}

export async function layout(root: string) {
  const p = paths(root);
  const current = await info(p.current);
  const legacy = await info(p.legacy);
  if (current && (!current.isDirectory() || current.isSymbolicLink()))
    throw new Error(
      `Expected a regular storage directory at ${p.current}. Preserve it and resolve its target before retrying.`,
    );
  let alias = false;
  if (legacy?.isSymbolicLink()) {
    alias = resolve(root, await readlink(p.legacy)) === p.current;
    if (!alias)
      throw new Error(`Unsafe legacy alias at ${p.legacy}. It must point to ${p.current}.`);
    if (!current)
      throw new Error(`Legacy alias ${p.legacy} has no canonical storage at ${p.current}.`);
  } else if (legacy && !legacy.isDirectory())
    throw new Error(`Expected a regular storage directory at ${p.legacy}.`);
  return { current: !!current, legacy: !!legacy && !alias, alias };
}

export async function readTransaction(root: string): Promise<Transaction | undefined> {
  const raw = await readJson(paths(root).state);
  if (raw === undefined) return undefined;
  const parsed = TransactionSchema.parse(raw);
  if (parsed.root !== root)
    throw new Error(`Migration belongs to a different root: ${parsed.root}`);
  return parsed;
}

export async function accepted(root: string): Promise<boolean> {
  const raw = await readJson(paths(root).accepted);
  if (raw === undefined) return false;
  const parsed = AcceptedSchema.parse(raw);
  if (parsed.root !== root)
    throw new Error("Migration acceptance belongs to a different storage root");
  return true;
}

export async function saveTransaction(state: Transaction): Promise<void> {
  await durableWrite(paths(state.root).state, `${JSON.stringify(state)}\n`);
}

export async function markAccepted(root: string): Promise<void> {
  await durableWrite(
    paths(root).accepted,
    `${JSON.stringify({ version: 1, root, acceptedAt: new Date().toISOString() })}\n`,
  );
}

export async function aliasCurrent(root: string): Promise<void> {
  const p = paths(root);
  const existing = await info(p.legacy);
  if (existing) {
    if (!(await layout(root)).alias)
      throw new Error(`Cannot replace independent storage at ${p.legacy}`);
    return;
  }
  await symlink(process.platform === "win32" ? p.current : ".flecten", p.legacy, "junction");
  await syncDirectory(root);
}

/** Atomic lock publication also survives a kill between writing its contents and taking it. */
export async function withRootLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  const p = paths(root);
  await ensureDirectory(p.transaction);
  return withFileLock(p.lock, task);
}
