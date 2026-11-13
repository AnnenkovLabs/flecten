import type { Locale } from "./locales";
import locale0 from "./messages/en/index";
import locale3 from "./messages/es/index";
import locale4 from "./messages/ja/index";
import locale2 from "./messages/pt-BR/index";
import locale6 from "./messages/ru/index";
import locale5 from "./messages/uk/index";
import locale1 from "./messages/zh-Hans/index";

export const english = locale0;
export type MessageKey = keyof typeof english;
export type Message = string | readonly (string | number)[];
export type Catalog = Record<MessageKey, Message>;

export const catalogs: Record<Locale, Catalog> = {
  en: locale0,
  "zh-Hans": locale1,
  "pt-BR": locale2,
  es: locale3,
  ja: locale4,
  uk: locale5,
  ru: locale6,
};
