import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readTolerant } from "../events/envelope";
import { SESSION_INDEX_VERSION, summarySchema } from "../events/index";
import { eventSchema } from "../events/read";
import { rebuildable } from "./content";
import {
  copyEntry,
  digest,
  durableWrite,
  type Entry,
  finishDirectories,
  manifest,
  sameManifest,
} from "./fs";
import { forEachConcurrent } from "./parallel";
import { paths, type Source, type Transaction } from "./state";

interface Selection {
  entry: Entry;
  source: Source;
  content?: string;
}
const indexSchema = z.object({
  version: z.literal(SESSION_INDEX_VERSION),
  sessions: z.array(summarySchema),
});

function journal(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === "sessions" && parts[2] === "events.jsonl";
}

function backup(state: Transaction, source: Source): string {
  return join(paths(state.root, state.revision).originals, source.name);
}

function conflict(state: Transaction, path: string): never {
  throw new Error(
    `Storage conflict at ${path}. Neither version was overwritten. Compare saved copies in ${paths(state.root, state.revision).originals}, resolve the conflicting files in ${paths(state.root).current} and ${paths(state.root).legacy}, then retry. Keep saved copies unchanged.`,
  );
}

async function prefixChoice(state: Transaction, current: Selection, next: Selection) {
  const leftPath = join(backup(state, current.source), current.entry.path);
  const rightPath = join(backup(state, next.source), next.entry.path);
  // ponytail: duplicate journals are compared in memory; stream the prefix comparison for multi-gigabyte journals.
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  const [short, long, chosen, chosenPath] =
    left.length <= right.length
      ? ([left, right, next, rightPath] as const)
      : ([right, left, current, leftPath] as const);
  if (
    (short.length > 0 && short.at(-1) !== 10) ||
    long.at(-1) !== 10 ||
    !long.subarray(0, short.length).equals(short)
  )
    return conflict(state, current.entry.path);
  const read = await readTolerant(chosenPath);
  if (
    read.corrupt.length ||
    read.envelopes.some(({ event }) => !eventSchema.safeParse(event).success)
  )
    return conflict(state, current.entry.path);
  return chosen;
}

async function mergedIndex(
  state: Transaction,
  selections: Selection[],
): Promise<Selection | undefined> {
  const summaries = new Map<string, z.infer<typeof summarySchema>>();
  for (const selection of selections) {
    if (selection.entry.kind !== "file") return conflict(state, "sessions/index.json");
    let raw: unknown;
    try {
      raw = JSON.parse(
        await readFile(join(backup(state, selection.source), "sessions/index.json"), "utf8"),
      );
    } catch {
      continue;
    }
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const summary of parsed.data.sessions)
      if (!summaries.has(summary.id)) summaries.set(summary.id, summary);
  }
  if (!summaries.size) return undefined;
  const content = `${JSON.stringify({ version: SESSION_INDEX_VERSION, sessions: [...summaries.values()] }, null, 2)}\n`;
  const source = selections[0]?.source;
  if (!source) return undefined;
  return {
    source,
    content,
    entry: {
      path: "sessions/index.json",
      kind: "file",
      hash: digest(Buffer.from(content)),
      size: Buffer.byteLength(content),
      mode: 0o600,
    },
  };
}

export async function mergePlan(state: Transaction): Promise<Selection[]> {
  const selected = new Map<string, Selection>();
  const indexes: Selection[] = [];
  for (const source of state.sources) {
    for (const entry of source.entries) {
      if (rebuildable(entry.path)) continue;
      const next = { source, entry };
      if (entry.path === "sessions/index.json") {
        indexes.push(next);
        continue;
      }
      const current = selected.get(entry.path);
      if (!current) {
        selected.set(entry.path, next);
        continue;
      }
      if (current.entry.kind !== entry.kind) conflict(state, entry.path);
      if (entry.kind === "directory") continue;
      if (
        entry.kind === "symlink" &&
        current.entry.kind === "symlink" &&
        current.entry.target === entry.target
      )
        continue;
      if (entry.kind === "file" && current.entry.kind === "file") {
        if (entry.hash === current.entry.hash && entry.size === current.entry.size) continue;
        if (journal(entry.path)) {
          selected.set(entry.path, await prefixChoice(state, current, next));
          continue;
        }
      }
      conflict(state, entry.path);
    }
  }
  if (indexes.length === 1) {
    const item = indexes[0];
    if (item) selected.set(item.entry.path, item);
  } else if (indexes.length > 1) {
    const merged = await mergedIndex(state, indexes);
    if (merged) selected.set(merged.entry.path, merged);
  }
  return [...selected.values()].sort((left, right) =>
    left.entry.path < right.entry.path ? -1 : left.entry.path > right.entry.path ? 1 : 0,
  );
}

export async function buildMerged(state: Transaction): Promise<Entry[]> {
  const selections = await mergePlan(state);
  const target = paths(state.root).staging;
  for (const { entry, source } of selections)
    if (entry.kind === "directory") await copyEntry(backup(state, source), target, entry);
  await forEachConcurrent(selections, async ({ entry, source, content }) => {
    if (entry.kind === "directory") return;
    if (content !== undefined) await durableWrite(join(target, entry.path), content);
    else await copyEntry(backup(state, source), target, entry);
  });
  await finishDirectories(
    target,
    selections.map(({ entry }) => entry),
  );
  const actual = await manifest(target);
  const planned = selections.map(({ entry }) => entry);
  const byPath = (entries: Entry[]) =>
    [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!sameManifest(byPath(actual), byPath(planned)))
    throw new Error(`Merged storage verification failed at ${target}`);
  return actual;
}
