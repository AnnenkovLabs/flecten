import { describe, expect, test } from "bun:test";
import { toolAction } from "../../ui/src/lib/agent";
import { countLabel, formatNumber } from "../../ui/src/lib/format";
import { catalogs, english } from "../../ui/src/lib/i18n/catalogs";
import { DEFAULT_LOCALE, isLocale, locales, savedLocale } from "../../ui/src/lib/i18n/locales";
import { i18n, setLocale, t } from "../../ui/src/lib/i18n.svelte";
import { renderMarkdown } from "../../ui/src/lib/markdown/render";
import { presetDescription } from "../../ui/src/lib/permissions";
import { TaskView } from "../../ui/src/lib/run/view.svelte";
import { searchSettingsSections } from "../../ui/src/lib/settings/sections";

const slots = (message: string | readonly (string | number)[]) =>
  typeof message === "string" ? [] : message.filter((part) => typeof part === "number").sort();

describe("interface languages", () => {
  test("a fresh or invalid preference uses English, independently of browser language", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(savedLocale()).toBe("en");
    expect(locales.map((locale) => locale.id)).toEqual([
      "en",
      "zh-Hans",
      "pt-BR",
      "es",
      "ja",
      "uk",
      "ru",
    ]);
    setLocale("en");
    setLocale("pt");
    setLocale({ locale: "ru" });
    expect(i18n.locale).toBe("en");
    expect(isLocale("zh-Hant")).toBe(false);
  });

  test("each catalog contains every message and preserves runtime values", () => {
    const keys = Object.keys(english).sort();
    for (const locale of locales) {
      const catalog = catalogs[locale.id];
      expect(Object.keys(catalog).sort()).toEqual(keys);
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        expect(slots(catalog[key])).toEqual(slots(english[key]));
        const parts = catalog[key];
        expect(typeof parts === "string" ? parts.length : parts.length).toBeGreaterThan(0);
      }
    }
  });

  test("counts follow each language, including Slavic forms and CJK order", () => {
    setLocale("en");
    expect(countLabel(1, "file")).toBe("1 file");
    expect(countLabel(21, "model")).toBe("21 models");
    setLocale("ru");
    expect([1, 2, 5, 11, 21].map((n) => countLabel(n, "file"))).toEqual([
      "1 файл",
      "2 файла",
      "5 файлов",
      "11 файлов",
      "21 файл",
    ]);
    setLocale("uk");
    expect([1, 3, 12].map((n) => countLabel(n, "model"))).toEqual([
      "1 модель",
      "3 моделі",
      "12 моделей",
    ]);
    setLocale("zh-Hans");
    expect(countLabel(3, "file")).toBe("3 个文件");
    setLocale("ja");
    expect(countLabel(3, "file")).toBe("ファイル 3 件");
    setLocale("pt-BR");
    expect(countLabel(2, "action")).toBe("2 ações");
    expect(formatNumber(12345)).toBe("12.345");
  });

  test("switching language updates existing tool actions, status and settings metadata", () => {
    setLocale("en");
    const rawPath = "src/Українська.ts";
    const action = toolAction({ id: "read", name: "read", args: { path: rawPath } });
    const view = new TaskView({ checkpointSaved() {} });
    view.begin("Не змінюй цей текст: 日本語, português.");
    expect(action.label).toBe("Read file");
    expect(action.subject).toBe(rawPath);
    expect(view.liveLabel).toBe("Thinking");
    const original = view.lastPrompt;
    const description = presetDescription("custom");
    setLocale("uk");
    expect(action.subject).toBe(rawPath);
    expect(action.label).not.toBe("Read file");
    expect(view.liveLabel).not.toBe("Thinking");
    expect(view.lastPrompt).toBe(original);
    expect(presetDescription("custom")).not.toBe(description);
    expect(searchSettingsSections("Українська").some((section) => section.id === "general")).toBe(
      true,
    );
  });

  test("markdown chrome translates while code, messages and interpolation stay exact", () => {
    for (const { id } of locales) {
      setLocale(id);
      const html = renderMarkdown("```ts\nconst message = 'Привет 日本語';\n```");
      expect(html).toContain("Привет 日本語");
      expect(html).toContain(`>${t("Copy")}</button>`);
      const raw = "<script>$HOME & `日本語`</script>";
      expect(t("Read {0}", [raw])).toContain(raw);
    }
  });
});
