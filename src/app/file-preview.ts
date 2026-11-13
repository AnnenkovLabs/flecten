import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { detectEncoding, SAMPLE_BYTES, sampleFile } from "../tools/util/encoding";
import { displayPath, isInside } from "../tools/util/paths";
import { redact } from "../util/redact";

/** Bytes the viewer gets at most; the rest stays on disk and the reply says so.
 * ponytail: no paging past the first 512 KB; a huge log opens in an external editor. */
export const PREVIEW_BYTES = 512 * 1024;

/** One file as the window may show it: from inside the project, bounded and redacted. */
export interface FilePreview {
  /** Path relative to the project, with forward slashes. */
  path: string;
  size: number;
  text: string;
  truncated: boolean;
  binary: boolean;
  /** Present only when the full UTF-8 source can be saved without information loss. */
  hash?: string;
  readOnlyReason?: string;
}

export function fileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Reads a project file or a tool log for the built-in viewer. Symlinks resolve before the
 * check, so a link cannot lead outside the project; FIFOs and devices are refused.
 */
export async function previewFile(cwd: string, path: string): Promise<FilePreview> {
  const root = await realpath(cwd);
  let target: string;
  try {
    target = await realpath(resolve(root, path));
  } catch {
    throw new Error(`file not found: ${path}`);
  }
  if (!isInside(root, target)) throw new Error(`file is outside the project: ${path}`);
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`not a regular file: ${path}`);
  const shown = displayPath(root, target);
  const bytes = await sampleFile(target, info.size, PREVIEW_BYTES);
  const detected = detectEncoding(bytes.subarray(0, SAMPLE_BYTES));
  if (detected.binary) {
    return {
      path: shown,
      size: info.size,
      text: "",
      truncated: false,
      binary: true,
      readOnlyReason: "Бинарный файл доступен только для просмотра.",
    };
  }
  const truncated = info.size > bytes.length;
  let text = new TextDecoder(detected.encoding).decode(bytes.subarray(detected.bomBytes));
  if (truncated) {
    // A cut in the middle of a line would show half a line as if it were the last one.
    const lastBreak = text.lastIndexOf("\n");
    if (lastBreak > 0) text = text.slice(0, lastBreak + 1);
  }
  const safeText = redact(text);
  const internal = shown.split("/")[0];
  let readOnlyReason: string | undefined;
  if (truncated) readOnlyReason = "Файл больше 512 КБ. Откройте его во внешнем редакторе.";
  else if (detected.encoding !== "utf-8")
    readOnlyReason = "Редактирование доступно для файлов UTF-8.";
  else if (safeText !== text)
    readOnlyReason = "Секреты скрыты. Откройте исходный файл во внешнем редакторе.";
  else if (internal === ".git" || internal === ".liquid")
    readOnlyReason = "Служебный файл доступен только для просмотра.";
  else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      readOnlyReason = "Файл содержит некорректный UTF-8. Откройте его во внешнем редакторе.";
    }
  }
  return {
    path: shown,
    size: info.size,
    text: safeText,
    truncated,
    binary: false,
    ...(readOnlyReason ? { readOnlyReason } : { hash: fileHash(bytes) }),
  };
}
