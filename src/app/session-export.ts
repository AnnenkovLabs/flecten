import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertSessionId } from "../store/events/index";
import { sessionPaths } from "../store/paths";

async function copyRegular(source: string, target: string): Promise<void> {
  if ((await lstat(source)).isSymbolicLink())
    throw new Error("Session export rejects symbolic links.");
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await input.stat();
    if (!info.isFile()) throw new Error("Session export accepts regular files only.");
    const output = await open(target, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let remaining = info.size;
      while (remaining > 0) {
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, remaining));
        if (bytesRead === 0) throw new Error("Session source changed during export.");
        remaining -= bytesRead;
        await output.writeFile(buffer.subarray(0, bytesRead));
      }
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Session export rejects symbolic links.");
}

/** Copies durable events and their media into one closed, atomically published directory. */
export async function exportSession(cwd: string, id: string): Promise<{ path: string }> {
  assertSessionId(id);
  await assertDirectory(join(cwd, ".liquid"));
  await assertDirectory(join(cwd, ".liquid", "sessions"));
  const directory = join(cwd, ".liquid", "exports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertDirectory(directory);
  await chmod(directory, 0o700);
  const source = sessionPaths(cwd, id);
  await assertDirectory(source.session);
  const destination = join(directory, `${id}-${crypto.randomUUID()}`);
  const temporary = `${destination}.tmp`;
  await mkdir(temporary, { mode: 0o700 });
  try {
    await copyRegular(source.events, join(temporary, "events.jsonl"));
    const attachments = await lstat(source.attachments).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (attachments) {
      await assertDirectory(source.attachments);
      await mkdir(join(temporary, "attachments"), { mode: 0o700 });
      for (const name of await readdir(source.attachments)) {
        const path = join(source.attachments, name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("Session export rejects non-regular attachments.");
        await copyRegular(path, join(temporary, "attachments", name));
      }
    }
    await rename(temporary, destination);
    return { path: join(destination, "events.jsonl") };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
