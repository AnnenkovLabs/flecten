import { conversationReply } from "../tests/helpers/conversation-provider.mjs";
import { subagentReply } from "../tests/helpers/subagent-provider.mjs";

const port = Number(process.env.E2E_MOCK_PORT ?? 0);
const delayMs = Math.max(0, Number(process.env.E2E_MOCK_DELAY_MS ?? 0));
const chunkMs = Math.max(0, Number(process.env.E2E_MOCK_CHUNK_MS ?? 0));
const summaryPauseMs = Math.max(0, Number(process.env.E2E_MOCK_SUMMARY_PAUSE_MS ?? 0));
const holdSummary = process.env.E2E_MOCK_HOLD_SUMMARY === "1";
const twinLearning = process.env.E2E_MOCK_TWIN_LEARNING === "1";
let releaseSummary;
const summaryReleased = new Promise((resolve) => {
  releaseSummary = resolve;
});
/** Final answer for previews (scripts/ui-preview.mjs `mockEnv`); without it, the README summary. */
const replyOverride = process.env.E2E_MOCK_REPLY;
const usage = process.env.E2E_MOCK_USAGE ? JSON.parse(process.env.E2E_MOCK_USAGE) : undefined;
/** First-turn tool calls for previews, JSON `[{"name":"read","arguments":{"path":"a.ts"}}]`. */
const firstCalls =
  process.env.E2E_MOCK_CALLS === undefined
    ? [{ id: "call_read_readme", name: "read", arguments: { path: "README.md" } }]
    : JSON.parse(process.env.E2E_MOCK_CALLS);

function chunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function event(delta, finishReason = null) {
  return chunk({
    id: "chatcmpl-e2e-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "e2e-model",
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

function hasToolResult(messages) {
  return Array.isArray(messages) && messages.some((message) => message?.role === "tool");
}

const summaryParts = [
  "Вот итог проверки.\n\n",
  "| Проверка | Результат |\n| --- | --- |\n| README найден | да |\n| Ошибок нет | да |\n\n",
  "<summary>\n",
  "<h2>README прочитан</h2>",
  "<p>Файл открыт и проверен. Ниже короткая сводка.</p>",
  "<table><thead><tr><th>Пункт</th><th>Значение</th></tr></thead><tbody>",
  "<tr><td>Файл</td><td><code>README.md</code></td></tr>",
  "<tr><td>Статус</td><td>готово</td></tr>",
  "</tbody></table>",
  '<div data-tabs><div role="tablist">',
  '<button type="button" role="tab" aria-selected="true" data-tab-target="panel-1">Первый</button>',
  '<button type="button" role="tab" aria-selected="false" data-tab-target="panel-2">Второй</button>',
  "</div>",
  '<section role="tabpanel" id="panel-1">Первый раздел</section>',
  '<section role="tabpanel" id="panel-2" hidden>Второй раздел</section>',
  "</div>",
  '<p id="summary-probe">JS не запущен</p>',
  '<script>document.getElementById("summary-probe").textContent = "JS работает";</script>',
  "</summary>",
];

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (request.method === "POST" && url.pathname === "/control/summary/continue") {
      releaseSummary();
      return new Response("ok");
    }
    if (request.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0)
        return new Response("missing audio", { status: 400 });
      await Bun.sleep(700);
      return Response.json({ text: "Добавь голосовой ввод." });
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }

    const body = await request.json();
    if (body.model === "eyes")
      return sse(
        `${event({ content: "A screenshot with a small test image." }, "stop")}data: [DONE]\n\n`,
      );
    if (delayMs > 0) await Bun.sleep(delayMs);
    if (twinLearning && (!body.tools || body.tools.length === 0)) {
      await summaryReleased;
      return sse(
        `${event({ content: JSON.stringify({ candidates: [] }) }, "stop")}data: [DONE]\n\n`,
      );
    }
    const conversation =
      (await subagentReply(
        body,
        firstCalls.some((call) => call.name === "task"),
        holdSummary ? summaryReleased : Promise.resolve(),
      )) ?? (await conversationReply(body));
    if (conversation) {
      const delta = conversation.calls
        ? {
            ...(conversation.text ? { content: conversation.text } : {}),
            tool_calls: conversation.calls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : { content: conversation.text };
      return sse(`${event(delta, conversation.calls ? "tool_calls" : "stop")}data: [DONE]\n\n`);
    }

    if (!hasToolResult(body.messages)) {
      return sse(
        [
          event({ role: "assistant", content: "Проверяю README. " }),
          event(
            {
              tool_calls: firstCalls.map((call, index) => ({
                index,
                id: call.id ?? `call_preview_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            },
            "tool_calls",
          ),
          "data: [DONE]\n\n",
        ].join(""),
      );
    }

    const finalEvents = [
      { body: event({ role: "assistant", content: "Файл прочитан. " }), part: "" },
      ...(replyOverride === undefined ? summaryParts : [replyOverride]).map((part, index) => ({
        body: event({ content: part }),
        part,
        pauseSummary: replyOverride === undefined && index === 2,
      })),
      { body: event({}, "stop"), part: "" },
      ...(usage
        ? [
            {
              body: chunk({
                usage: {
                  prompt_tokens: usage.input,
                  completion_tokens: usage.output,
                  prompt_tokens_details: { cached_tokens: usage.cached },
                  completion_tokens_details: { reasoning_tokens: usage.reasoning },
                },
              }),
              part: "",
            },
          ]
        : []),
      { body: "data: [DONE]\n\n", part: "" },
    ];

    if (chunkMs > 0 || summaryPauseMs > 0 || holdSummary) {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for (const item of finalEvents) {
              controller.enqueue(encoder.encode(item.body));
              if (holdSummary && item.pauseSummary) await summaryReleased;
              const wait = item.pauseSummary ? summaryPauseMs : chunkMs;
              if (wait > 0) await Bun.sleep(wait);
            }
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return sse(finalEvents.map((item) => item.body).join(""));
  },
});

console.error(`e2e mock provider on http://127.0.0.1:${server.port}/v1`);
console.log(JSON.stringify({ port: server.port }));
