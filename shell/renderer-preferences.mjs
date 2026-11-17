import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = "/profile-migration";

/** The retired origin serves only an empty document for copying its saved preferences. */
export function preferenceMigrationDocument(request) {
  const url = new URL(request.url);
  if (url.host !== "app" || url.pathname !== MIGRATION_PATH)
    return new Response("Not found", { status: 404 });
  return new Response("<!doctype html><html><head><title>Flecten</title></head><body></body></html>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

/** Chromium scopes localStorage by origin, so renaming the scheme needs one profile migration. */
export async function migrateRendererPreferences(WebContentsView, profile) {
  const marker = join(profile, "flecten-renderer-origin-v1");
  if (existsSync(marker)) return;
  if (!existsSync(join(profile, "Local Storage"))) {
    writeFileSync(marker, "1\n");
    return;
  }
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const contents = view.webContents;
  try {
    await contents.loadURL(`liquid://app${MIGRATION_PATH}`);
    const saved = await contents.executeJavaScript("Object.entries(localStorage)");
    if (!Array.isArray(saved) || saved.some((entry) =>
      !Array.isArray(entry) || entry.length !== 2 || entry.some((value) => typeof value !== "string")))
      throw new Error("Invalid saved renderer preferences");
    await contents.loadURL(`flecten://app${MIGRATION_PATH}`);
    await contents.executeJavaScript(`for (const [key, value] of ${JSON.stringify(saved)}) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    }`);
    writeFileSync(marker, "1\n");
  } finally {
    contents.close();
  }
}
