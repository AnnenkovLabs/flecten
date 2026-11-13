import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { sampleFile } from "../tools/util/encoding";
import { isInside } from "../tools/util/paths";
import { atomicWrite } from "../util/atomic";
import { Mutex } from "../util/mutex";
import { type FilePreview, fileHash, PREVIEW_BYTES, previewFile } from "./file-preview";

const SaveFile = z.object({
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((path) => !path.includes("\0"), "Invalid file path"),
  text: z.string().max(PREVIEW_BYTES),
  expectedHash: z
    .string()
    .length(64)
    .refine(
      (hash) =>
        [...hash].every((char) => (char >= "a" && char <= "f") || (char >= "0" && char <= "9")),
      "expectedHash must be a SHA-256 hash",
    ),
});

const saves = new Mutex();

/** Existing files only: an editor cannot silently create a stale or renamed path. */
export async function saveProjectFile(cwd: string, input: unknown): Promise<FilePreview> {
  const parsed = SaveFile.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid file save: ${parsed.error.message}`);
  const command = parsed.data;
  if (Buffer.byteLength(command.text, "utf8") > PREVIEW_BYTES) {
    throw new Error("Файл больше 512 КБ. Сократите текст или используйте внешний редактор.");
  }
  return saves.run(async () => {
    const root = await realpath(cwd);
    const target = await realpath(resolve(root, command.path));
    if (!isInside(root, target)) throw new Error("Файл находится вне проекта.");
    const current = await previewFile(root, target);
    if (current.readOnlyReason || !current.hash) {
      throw new Error(current.readOnlyReason ?? "Файл доступен только для просмотра.");
    }
    if (current.hash !== command.expectedHash) {
      throw new Error("Файл изменился на диске. Откройте актуальную версию перед сохранением.");
    }
    const info = await stat(target);
    if (!info.isFile() || info.size > PREVIEW_BYTES) {
      throw new Error("Файл изменился на диске. Откройте актуальную версию перед сохранением.");
    }
    const before = await sampleFile(target, info.size, PREVIEW_BYTES);
    if (fileHash(before) !== command.expectedHash) {
      throw new Error("Файл изменился на диске. Откройте актуальную версию перед сохранением.");
    }
    const bom = before[0] === 0xef && before[1] === 0xbb && before[2] === 0xbf ? "\uFEFF" : "";
    if (Buffer.byteLength(`${bom}${command.text}`, "utf8") > PREVIEW_BYTES) {
      throw new Error("Файл больше 512 КБ. Сократите текст или используйте внешний редактор.");
    }
    // ponytail: optimistic saves protect edits since open; filesystem-wide locking is needed
    // to exclude a separate process changing the file during the final atomic rename.
    await atomicWrite(target, `${bom}${command.text}`, info.mode & 0o777);
    return previewFile(root, target);
  });
}
