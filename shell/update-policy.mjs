export const STARTUP_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const RETRY_BASE_MS = 15 * 60 * 1000;
export const SETTINGS_CHECK_DELAY_MS = 2_000;

function isLoopback(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1"
  );
}

export function parseUpdateUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url.toString();
  return null;
}

/** Stable releases publish electron-builder's default "latest" channel files. */
export function updateChannel(channel) {
  return channel === "beta" ? "beta" : "latest";
}

export const PRODUCT_GITHUB = Object.freeze({ owner: "AnnenkovLabs", repo: "flecten" });

/**
 * Source precedence: an explicit feed URL, then configured GitHub releases,
 * then the product's GitHub releases in packaged builds. Dev stays offline.
 */
export function updateSource(settings, envUrl, packaged) {
  const raw = settings.feedUrl ?? envUrl;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { kind: "feed", url: parseUpdateUrl(raw) };
  }
  if (settings.github) {
    return { kind: "github", owner: settings.github.owner, repo: settings.github.repo };
  }
  if (packaged) return { kind: "github", ...PRODUCT_GITHUB };
  return { kind: "none" };
}

export function backgroundCheckDelayMs(failures) {
  if (failures <= 0) return CHECK_INTERVAL_MS;
  return Math.min(CHECK_INTERVAL_MS, RETRY_BASE_MS * 2 ** (failures - 1));
}