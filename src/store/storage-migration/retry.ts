import { link } from "node:fs/promises";
import { join } from "node:path";
import { info, manifest, sameManifest, syncDirectory } from "./fs";
import { layout, paths, saveTransaction, type Transaction } from "./state";

async function archiveFullPlan(state: Transaction): Promise<void> {
  const p = paths(state.root);
  const archive = join(p.transaction, `state-${state.revision}-full.json`);
  try {
    // State publication replaces its inode, so this exact previous state stays unchanged.
    await link(p.state, archive);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const [current, previous] = await Promise.all([info(p.state), info(archive)]);
    if (!current || !previous || current.dev !== previous.dev || current.ino !== previous.ino)
      throw new Error(`Preserve the archived migration plan at ${archive} before retrying.`);
  }
  await syncDirectory(p.transaction);
}

/** Corrected source stores may start a new plan only while neither original has moved. */
export async function replanCorrectedSources(state: Transaction): Promise<Transaction> {
  if (!["planned", "backed-up", "merged", "verified"].includes(state.phase)) return state;
  const p = paths(state.root);
  for (const name of ["current", "legacy"]) {
    if (await info(`${p.transaction}/retired-${name}`)) return state;
  }
  const stores = await layout(state.root);
  const upgrade =
    state.sources.some((source) => source.scope === "full") &&
    state.sources.every((source) => stores[source.name]);
  const sources: Transaction["sources"] = [];
  for (const name of ["current", "legacy"] as const) {
    if (!stores[name]) continue;
    const scope = upgrade
      ? "durable"
      : (state.sources.find((source) => source.name === name)?.scope ?? "durable");
    sources.push({ name, scope, entries: await manifest(p[name], scope) });
  }
  const changed =
    upgrade ||
    sources.length !== state.sources.length ||
    sources.some((source, index) => {
      const previous = state.sources[index];
      return (
        !previous ||
        source.name !== previous.name ||
        !sameManifest(source.entries, previous.entries)
      );
    });
  if (!changed) return state;
  if (state.revision >= 1024)
    throw new Error(
      `Too many storage migration attempts at ${state.root}. Review ${p.transaction}.`,
    );
  const next: Transaction = {
    version: 1,
    root: state.root,
    phase: "planned",
    alias: stores.alias,
    revision: state.revision + 1,
    sources,
  };
  if (upgrade) await archiveFullPlan(state);
  // A new backup directory preserves every previous attempt, including failed copies.
  await saveTransaction(next);
  return next;
}
