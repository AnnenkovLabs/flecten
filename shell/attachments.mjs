import { mkdtempSync, openSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".webm"]);
const SNIFF_BYTES = 8192;

function looksBinary(path) {
  const buffer = Buffer.alloc(SNIFF_BYTES);
  let fd;
  try {
    fd = openSync(path, "r");
    const read = readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Describes picked, dropped or pasted paths the way the composer chips need them. */
export function describePath(path) {
  try {
    const info = statSync(path);
    const name = basename(path) || path;
    if (info.isDirectory()) return { path, name, size: 0, kind: "folder" };
    const extension = extname(path).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) return { path, name, size: info.size, kind: "image" };
    if (AUDIO_EXTENSIONS.has(extension)) return { path, name, size: info.size, kind: "audio" };
    if (extension === ".pdf") return { path, name, size: info.size, kind: "pdf" };
    return { path, name, size: info.size, kind: looksBinary(path) ? "file" : "text" };
  } catch {
    return null;
  }
}

export function describePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((path) => typeof path === "string" && path.length > 0)
    .slice(0, 50)
    .map(describePath)
    .filter((entry) => entry !== null);
}

export function registerAttachmentIpc({ BrowserWindow, clipboard, dialog, ipcMain, isTrusted }) {
  ipcMain.handle("liquid:pick-attachments", async (event) => {
    if (!isTrusted(event)) return [];
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All files", extensions: ["*"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Audio", extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) },
      ],
    });
    if (result.canceled) return [];
    return describePaths(result.filePaths);
  });

  ipcMain.handle("liquid:describe-paths", (event, paths) => {
    if (!isTrusted(event)) return [];
    return describePaths(paths);
  });

  ipcMain.handle("liquid:paste-image", async (event) => {
    if (!isTrusted(event)) return null;
    const items = await clipboard.read();
    const image = items.find((item) => item.types.includes("image/png"));
    if (!image) return null;
    const blob = await image.getType("image/png");
    if (blob.size > 10 * 1024 * 1024) throw new Error("Clipboard image exceeds the 10 MiB limit.");
    const directory = mkdtempSync(join(tmpdir(), "flecten-images-"));
    const path = join(directory, "clipboard.png");
    writeFileSync(path, Buffer.from(await blob.arrayBuffer()), { mode: 0o600 });
    return { path, name: "clipboard.png", size: statSync(path).size, kind: "image" };
  });
}
