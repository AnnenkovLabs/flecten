import type { MemoryPort } from "../core/memory/types";
import { MemoryStore } from "../store/memory";

/** A live port shared by project sessions; count is diagnostic, never the model's snapshot. */
export function projectMemory(cwd: string, secrets: () => readonly string[]) {
  const store = new MemoryStore({ cwd, secrets });
  let count = 0;
  const refresh = async () => {
    const records = await store.list();
    count = records.filter(
      (record) =>
        record.status === "active" &&
        (!record.expiresAt || Date.parse(record.expiresAt) > Date.now()),
    ).length;
    return records;
  };
  const port: MemoryPort = {
    list: refresh,
    async put(input) {
      const record = await store.put(input);
      await refresh();
      return record;
    },
    async reconcile(input) {
      const result = await store.reconcile(input);
      await refresh();
      return result;
    },
    async forget(id, revision) {
      const record = await store.forget(id, revision);
      await refresh();
      return record;
    },
  };
  return {
    port,
    get count() {
      return count;
    },
  };
}

/** Child assignments carry no authority to change project-wide user preferences. */
export function readOnlyMemory(port: MemoryPort): MemoryPort {
  const refused = async (): Promise<never> => {
    throw new Error("Child memory is read-only. Return evidence to the parent agent.");
  };
  return { list: () => port.list(), put: refused, forget: refused, reconcile: refused };
}
