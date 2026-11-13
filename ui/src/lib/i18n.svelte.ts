import { catalogs, english, type MessageKey } from "./i18n/catalogs";
import { isLocale, LOCALE_STORAGE_KEY, savedLocale } from "./i18n/locales";

export const i18n = $state({ locale: savedLocale() });

/** UI language belongs to this app profile, independently of agent and voice settings. */
export function setLocale(value: unknown): void {
  if (!isLocale(value)) return;
  i18n.locale = value;
  if (typeof document !== "undefined") document.documentElement.lang = value;
  if (typeof window !== "undefined") window.desktop?.setLocale?.(value);
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // A blocked storage backend must not prevent changing the language in this window.
  }
}

export function t(key: MessageKey, values: readonly unknown[] = []): string {
  const message = catalogs[i18n.locale][key] ?? english[key];
  if (typeof message === "string") return message;
  return message
    .map((part) => (typeof part === "number" ? String(values[part] ?? "") : part))
    .join("");
}

export function initializeLocale(): () => void {
  if (typeof window === "undefined") return () => {};
  document.documentElement.lang = i18n.locale;
  window.desktop?.setLocale?.(i18n.locale);
  const sync = (event: StorageEvent): void => {
    if (event.key === LOCALE_STORAGE_KEY) {
      i18n.locale = isLocale(event.newValue) ? event.newValue : "en";
      document.documentElement.lang = i18n.locale;
      window.desktop?.setLocale?.(i18n.locale);
    }
  };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}
