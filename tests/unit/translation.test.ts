import { describe, expect, test } from "bun:test";
import { RunSpend } from "../../src/app/run-spend";
import { HarnessConfigSchema } from "../../src/config/schema";
import { RunBudget } from "../../src/core/session/budget";
import type { Message } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { TranslationClient } from "../../src/translation/client";
import { stableTranslationPrefix, translationDocument } from "../../src/translation/document";
import { LanguageRun } from "../../src/translation/run";
import { TranslationStream } from "../../src/translation/stream";
import { scriptedProvider } from "../helpers/fake-provider";

function translated(language: string, texts: string[]): ModelEvent[] {
  return [
    {
      type: "tool_call",
      name: "translation_result",
      id: "translation",
      args: { sourceLanguage: language, allEnglish: language === "en", texts },
    },
    { type: "usage", input: 10, output: 5, cached: 0 },
    { type: "done", reason: "tool_use" },
  ];
}

describe("translation boundary", () => {
  test("preserves executable HTML, Markdown, entities, links and literal code by source offsets", () => {
    const source =
      '# Heading\n\nRead `src/кошик.ts` and [docs](https://example.com/ru).\n\n```js\nconst title = "Не менять";\n```\n\n<summary><p title="keep">Ready &amp; safe.</p><style>p{color:red}</style><script>const n="Ready"</script><pre>literal</pre><span translate="no">Acme</span></summary>';
    const document = translationDocument(source);
    expect(document.restore(document.texts)).toBe(source);
    expect(document.texts.join("|")).not.toContain("const title");
    expect(document.texts.join("|")).not.toContain("src/кошик.ts");
    expect(document.texts.join("|")).not.toContain("https://");
    expect(document.texts).toContain("Ready & safe.");
    const result = document.restore(
      document.texts.map((text) =>
        text === "Ready & safe." ? "Готово <script>bad()</script> & безопасно." : text,
      ),
    );
    expect(result).toContain(
      '<p title="keep">Готово &lt;script&gt;bad()&lt;/script&gt; &amp; безопасно.</p>',
    );
    expect(result).toContain('<script>const n="Ready"</script>');
    expect(result).toContain('<span translate="no">Acme</span>');
    expect(() => document.restore([])).toThrow("count");
  });

  test("streams completed sentences but holds incomplete code and HTML", () => {
    expect(stableTranslationPrefix("First sentence. Second sentence still coming")).toBe(16);
    expect(stableTranslationPrefix("```ts\nconst x = 1;")).toBe(0);
    expect(stableTranslationPrefix("<summary><p>First sentence. Second sentence")).toBe(0);
  });

  test("nested Markdown and inline HTML protect code, link destinations and formatting", () => {
    const source =
      '> First line\n> second line\n>\n> - **Read** `src/кошик.ts`\n>   continuation\n\n| Name | Value |\n| --- | --- |\n| Ready | `literal` |\n\nVisit <https://example.com/path> or <a href="/ru">**docs** `const x="<code>"`</a> and <code>keep</code> text.';
    const document = translationDocument(source);
    expect(document.restore(document.texts)).toBe(source);
    expect(document.texts).toContain("second line");
    expect(document.texts).toContain("continuation");
    expect(document.texts).toContain("docs");
    expect(document.texts.join("|")).not.toContain("https://");
    expect(document.texts.join("|")).not.toContain("src/кошик.ts");
    expect(document.texts.join("|")).not.toContain("const x");
    expect(document.texts.join("|")).not.toContain("keep");
    const output = document.restore(document.texts.map(() => "Перевод"));
    expect(output).toContain("> Перевод\n> Перевод");
    expect(output).toContain("**Перевод** `src/кошик.ts`");
    expect(output).toContain('<a href="/ru">**Перевод** `const x="<code>"`</a>');
    expect(output).toContain("<code>keep</code>");
  });

  test("mixed English instructions still translate their non-English segments", async () => {
    const script = translated("en", ["Work carefully.", "Keep the API."]);
    const first = script[0];
    if (first?.type === "tool_call")
      first.args = {
        sourceLanguage: "en",
        allEnglish: false,
        texts: ["Work carefully.", "Keep the API."],
      };
    const client = new TranslationClient(scriptedProvider([script]), 1000);
    expect(
      (
        await client.translate(
          "Work carefully.\n\nСохрани API.",
          "en",
          new AbortController().signal,
          () => {},
        )
      ).text,
    ).toBe("Work carefully.\n\nKeep the API.");
  });

  test("stream coalesces deltas, serializes requests and presents text before finish", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const displayed = Promise.withResolvers<void>();
    let calls = 0;
    const client = new TranslationClient(
      {
        id: "t",
        model: "t",
        async *stream() {
          calls++;
          if (calls === 1) {
            started.resolve();
            await release.promise;
          }
          yield* translated("en", [`Перевод ${calls}.`]);
        },
      },
      1000,
    );
    const language = new LanguageRun(
      { client, language: "ru", providerId: "t", price: () => 0 },
      new AbortController().signal,
      () => {},
    );
    language.language = "ru";
    let text = "";
    const stream = new TranslationStream(language, (_, delta) => {
      text += delta;
      displayed.resolve();
    });
    stream.push("text", `${"First sentence is completed. ".repeat(8)}Tail`);
    await started.promise;
    for (let index = 0; index < 20; index++) stream.push("text", " fragment");
    expect(calls).toBe(1);
    release.resolve();
    await displayed.promise;
    expect(text).toBe("Перевод 1. ");
    expect((await stream.finish()).text).toBe("Перевод 1. Перевод 2.");
    expect(calls).toBe(2);
    await stream.cancel();
  });

  test("English input is byte-identical and repeated translations cost no new request", async () => {
    const provider = scriptedProvider([translated("en", [])]);
    const client = new TranslationClient(provider, 1000);
    const signal = new AbortController().signal;
    let calls = 0;
    expect(await client.translate("Keep  THIS\nexactly.", "en", signal, () => calls++)).toEqual({
      text: "Keep  THIS\nexactly.",
      language: "en",
    });
    await client.translate("Keep  THIS\nexactly.", "en", signal, () => calls++);
    expect(calls).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  test("rejects truncated, malformed, missing and duplicated model segments", async () => {
    for (const script of [
      translated("ru", []),
      translated("ru", [""]),
      [...translated("ru", ["Fix"]), ...translated("ru", ["Fix"])],
      [...translated("ru", ["Fix"]).slice(0, -1), { type: "done", reason: "max_tokens" } as const],
      [
        {
          type: "tool_call",
          id: "x",
          name: "translation_result",
          args: { texts: ["Fix"] },
        } as const,
      ],
    ]) {
      const client = new TranslationClient(scriptedProvider([script]), 1000);
      await expect(
        client.translate("Исправь", "en", new AbortController().signal, () => {}),
      ).rejects.toThrow();
    }
  });

  test("translation usage is priced separately from worker usage", () => {
    const budget = new RunBudget({ maxCostUsd: 3 }, () => 2);
    budget.add({ input: 10, output: 0, cached: 0 });
    budget.add({ input: 20, output: 0, cached: 0 }, () => 0.25);
    expect(budget.view().spent.costUsd).toBe(2.25);
    expect(budget.view().spent.tokens).toBe(30);
    expect(budget.exhausted()).toBeUndefined();
    budget.add({ input: 1, output: 0, cached: 0 }, () => undefined);
    expect(budget.view().spent.costUsd).toBeUndefined();
    const spend = new RunSpend();
    spend.note({
      type: "session.started",
      sessionId: "test",
      provider: "worker",
      model: "m",
      prompt: "p",
    });
    spend.note({ type: "budget", sessionId: "test", budget: budget.view() });
    expect(spend.get("test")?.cost).toBeUndefined();
  });

  test("configuration requires an existing tool-capable translator", () => {
    expect(
      HarnessConfigSchema.safeParse({
        conversation: { enabled: false },
        translation: { enabled: true, provider: "missing", model: "missing" },
      }).success,
    ).toBe(false);
  });

  test("enabling translation on a resumed legacy session retains the user's language", async () => {
    const history: Message[] = [{ role: "user", content: "Почини." }];
    const client = new TranslationClient(
      scriptedProvider([translated("en", []), translated("ru", ["Fix it."])]),
      1000,
    );
    const language = new LanguageRun(
      { client, language: "auto", providerId: "t", price: () => 0 },
      new AbortController().signal,
      () => {},
    );
    expect(await language.prepare("Continue.", "Continue.", history, true)).toBe("Continue.");
    expect(language.language).toBe("ru");
    expect(history[0]).toMatchObject({
      content: "Fix it.",
      sourceLanguage: "ru",
      workingLanguage: "en",
    });
  });
});
