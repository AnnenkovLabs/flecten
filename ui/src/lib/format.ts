import type { Locale } from "./i18n/locales";
import { i18n } from "./i18n.svelte";

export function plural(count: number, one: string, few: string, many: string): string {
  const form = new Intl.PluralRules("ru").select(count);
  return form === "one" ? one : form === "few" ? few : many;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(i18n.locale).format(value);
}

type CountKind = "file" | "model" | "action" | "request";
type Forms = readonly [string, string, string];
const WORDS: Record<Locale, Record<CountKind, Forms>> = {
  en: {
    file: ["file", "files", "files"],
    model: ["model", "models", "models"],
    action: ["action", "actions", "actions"],
    request: ["request", "requests", "requests"],
  },
  "zh-Hans": {
    file: ["个文件", "个文件", "个文件"],
    model: ["个模型", "个模型", "个模型"],
    action: ["次操作", "次操作", "次操作"],
    request: ["个请求", "个请求", "个请求"],
  },
  "pt-BR": {
    file: ["arquivo", "arquivos", "arquivos"],
    model: ["modelo", "modelos", "modelos"],
    action: ["ação", "ações", "ações"],
    request: ["solicitação", "solicitações", "solicitações"],
  },
  es: {
    file: ["archivo", "archivos", "archivos"],
    model: ["modelo", "modelos", "modelos"],
    action: ["acción", "acciones", "acciones"],
    request: ["solicitud", "solicitudes", "solicitudes"],
  },
  ja: {
    file: ["ファイル", "ファイル", "ファイル"],
    model: ["モデル", "モデル", "モデル"],
    action: ["操作", "操作", "操作"],
    request: ["リクエスト", "リクエスト", "リクエスト"],
  },
  uk: {
    file: ["файл", "файли", "файлів"],
    model: ["модель", "моделі", "моделей"],
    action: ["дія", "дії", "дій"],
    request: ["запит", "запити", "запитів"],
  },
  ru: {
    file: ["файл", "файла", "файлов"],
    model: ["модель", "модели", "моделей"],
    action: ["действие", "действия", "действий"],
    request: ["запрос", "запроса", "запросов"],
  },
};

export function countLabel(count: number, kind: CountKind): string {
  const locale = i18n.locale;
  const forms = WORDS[locale][kind];
  const form = new Intl.PluralRules(locale).select(count);
  const word =
    locale === "ru" || locale === "uk"
      ? plural(count, ...forms)
      : form === "one" && (locale !== "pt-BR" || count === 1)
        ? forms[0]
        : forms[2];
  const number = formatNumber(count);
  return locale === "ja" ? `${word} ${number} 件` : `${number} ${word}`;
}

export const modelsCount = (count: number): string => countLabel(count, "model");

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

/** OS window title (taskbar, window switcher): the open task first, then the app. */
export function windowTitle(task: string): string {
  const name = task.trim();
  return name.length > 0 ? `${name} · Flecten` : "Flecten";
}
