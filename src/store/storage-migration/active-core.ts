import { z } from "zod";
import { info, readJson } from "./fs";
import { paths } from "./state";

const HolderSchema = z.object({ pid: z.number().int().positive() });

/** The migration lock excludes migrations; these locks exclude existing old or new cores. */
export async function assertNoActiveCore(root: string): Promise<void> {
  const p = paths(root);
  for (const store of [p.current, p.legacy]) {
    const present = await info(store);
    if (!present || present.isSymbolicLink()) continue;
    const path = `${store}/sidecar.lock`;
    let value: unknown;
    try {
      value = await readJson(path);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    const holder = HolderSchema.safeParse(value);
    if (!holder.success) continue;
    let alive = false;
    try {
      process.kill(holder.data.pid, 0);
      alive = true;
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code === "EPERM";
    }
    if (alive)
      throw new Error(
        `A core is still using ${store} (process ${holder.data.pid}). Close its Flecten or Liquid window, then retry migration. No storage was replaced.`,
      );
  }
}
