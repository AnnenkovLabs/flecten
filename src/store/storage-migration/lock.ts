import { randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { digest, durableWrite, readJson, syncDirectory } from "./fs";

const HolderSchema = z.object({ pid: z.number().int().positive(), token: z.string() });
type Holder = z.infer<typeof HolderSchema>;

function running(holder: Holder | undefined): boolean {
  if (!holder) return false;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function holderAt(path: string): Promise<Holder | undefined> {
  let raw: unknown;
  try {
    raw = await readJson(path);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const parsed = HolderSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

async function release(path: string, holder: Holder): Promise<void> {
  if ((await holderAt(path))?.token !== holder.token) return;
  await rm(path, { force: true });
  await syncDirectory(dirname(path));
}

async function acquire(path: string, temporary: string, holder: Holder, depth = 0): Promise<void> {
  if (depth > 16)
    throw new Error(
      `Repeated interrupted lock recovery at ${path}. Close other app windows and retry.`,
    );
  for (;;) {
    try {
      await link(temporary, path);
      await syncDirectory(dirname(path));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const previous = await holderAt(path);
    if (running(previous))
      throw new Error(
        `Storage migration is already running at ${path}. Close its other window and retry.`,
      );
    // Reapers of the same dead holder serialize before unlinking. Recheck after taking it,
    // so a slower reaper can never remove the new live writer's lock.
    const key = digest(Buffer.from(`${path}:${previous?.token ?? "broken"}`)).slice(0, 24);
    const reaper = join(dirname(path), `reaper-${key}.lock`);
    await acquire(reaper, temporary, holder, depth + 1);
    try {
      const current = await holderAt(path);
      if (running(current))
        throw new Error(
          `Storage migration is already running at ${path}. Close its other window and retry.`,
        );
      if (current?.token !== previous?.token) continue;
      await rm(path, { force: true });
      await syncDirectory(dirname(path));
      try {
        await link(temporary, path);
        await syncDirectory(dirname(path));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } finally {
      await release(reaper, holder);
    }
  }
}

export async function withFileLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const holder = { pid: process.pid, token: randomUUID() };
  const temporary = `${path}.${holder.token}`;
  await durableWrite(temporary, JSON.stringify(holder));
  try {
    await acquire(path, temporary, holder);
    return await task();
  } finally {
    await rm(temporary, { force: true });
    await release(path, holder);
  }
}
