export const locales = [
  { id: "en", name: "English" },
  { id: "zh-Hans", name: "简体中文" },
  { id: "pt-BR", name: "Português (Brasil)" },
  { id: "es", name: "Español" },
  { id: "ja", name: "日本語" },
  { id: "uk", name: "Українська" },
  { id: "ru", name: "Русский" },
] as const;

export type Locale = (typeof locales)[number]["id"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "flecten.locale";

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale.id === value);
}

export function savedLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
