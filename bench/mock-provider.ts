import type { BenchTurn } from "./schema";

export interface MockRequest {
  index: number;
  body: Record<string, unknown>;
}

export interface MockProvider {
  baseUrl: string;
  requests: MockRequest[];
  scriptExhausted: boolean;
  stop(): void;
}

const MODEL = "bench-mock-1";

function chunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function delta(
  value: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: "chatcmpl-bench",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta: value, finish_reason: finishReason }],
  };
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

export function createMockProvider(script: BenchTurn[]): MockProvider {
  const requests: MockRequest[] = [];
  let exhausted = false;
  let workerIndex = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 });
      }
      const body = (await request.json()) as Record<string, unknown>;
      const index = requests.length;
      requests.push({ index, body });
      // Page summaries are a separate provider request and must not consume a scripted worker turn.
      // Return no summary so the real PageWriter exercises its deterministic recovery path.
      const summarizing = !Array.isArray(body.tools) || body.tools.length === 0;
      const turn = summarizing ? { text: "", calls: [], stop: "end" as const } : script[workerIndex++];
      if (turn === undefined) {
        exhausted = true;
        const text = "Bench script exhausted.";
        const events = [
          chunk(delta({ role: "assistant", content: text })),
          chunk({ ...delta({}, "stop"), usage: { prompt_tokens: estimateTokens(body), completion_tokens: 4 } }),
          "data: [DONE]\n\n",
        ];
        return new Response(events.join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      }

      const calls = turn.calls.map((call, callIndex) => ({
        index: callIndex,
        id: `call_${index}_${callIndex}`,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      }));
      const finish =
        turn.calls.length > 0 ? "tool_calls" : turn.stop === "max_tokens" ? "length" : "stop";
      const payloads: string[] = [];
      if (turn.text) payloads.push(chunk(delta({ role: "assistant", content: turn.text })));
      if (calls.length > 0) payloads.push(chunk(delta({ tool_calls: calls }, "tool_calls")));
      const output = estimateTokens({ text: turn.text ?? "", calls });
      payloads.push(
        chunk({
          id: "chatcmpl-bench",
          object: "chat.completion.chunk",
          created: 0,
          model: MODEL,
          choices: [],
          usage: { prompt_tokens: estimateTokens(body), completion_tokens: output },
        }),
      );
      payloads.push(chunk(delta({}, finish)));
      payloads.push("data: [DONE]\n\n");
      return new Response(payloads.join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    get scriptExhausted() {
      return exhausted;
    },
    stop() {
      server.stop(true);
    },
  };
}
