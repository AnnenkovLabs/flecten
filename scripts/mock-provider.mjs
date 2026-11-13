const port = Number(process.env.MOCK_PORT ?? 18765);
let calls = 0;

function chunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function event(delta, finishReason = null) {
  return chunk({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-1",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function sse(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }
    await request.json();
    calls += 1;

    if (calls === 1) {
      return sse(
        [
          event({ role: "assistant", content: "Проверяю README. " }),
          event(
            {
              tool_calls: [
                {
                  index: 0,
                  id: "call_read_readme",
                  type: "function",
                  function: { name: "read", arguments: '{"path":"README.md"}' },
                },
              ],
            },
            "tool_calls",
          ),
          "data: [DONE]\n\n",
        ].join(""),
      );
    }

    const summary = [
      "<h2>README прочитан</h2>",
      "<p>Файл открыт и проверен. Ниже короткая сводка.</p>",
      "<table><thead><tr><th>Пункт</th><th>Значение</th></tr></thead><tbody><tr><td>Файл</td><td><code>README.md</code></td></tr><tr><td>Статус</td><td>готово</td></tr></tbody></table>",
      '<p><button data-summary-action="copy" data-summary-payload="README.md">Скопировать имя</button></p>',
    ].join("");
    return sse(
      [
        event({ role: "assistant", content: "Файл прочитан. " }),
        event(
          {
            content: [
              "Вот итог проверки.",
              "",
              "| Проверка | Результат |",
              "| --- | --- |",
              "| README найден | да |",
              "| Ошибок нет | да |",
              "",
              `<summary>${summary}</summary>`,
            ].join("\n"),
          },
          "stop",
        ),
        "data: [DONE]\n\n",
      ].join(""),
    );
  },
});

console.log(`mock provider on http://127.0.0.1:${server.port}/v1`);
