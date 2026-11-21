import { expect, test } from "bun:test";
import type { ModelProvider } from "../../src/providers/types";
import { delegate, type InferenceTarget, learn } from "../../src/twin/inference";
import { TwinInferenceError } from "../../src/twin/inference-error";
import type { SourceMessage } from "../../src/twin/sources";

const decision = {
  verdict: "pass",
  voice: "Keep `checkout` on one screen, including the literal ``` in the example.",
  instructions: "",
  entryIds: [],
  emotion: "calm",
};
const json = JSON.stringify(decision);
const input = {
  phase: "final" as const,
  userMessages: ["One screen"],
  task: "Build checkout",
  directive: "One screen",
  evidence: [],
};
const usage = { input: 50, output: 30, cached: 2, costUsd: 0.001 };

function fixture(response: string) {
  let requests = 0;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream() {
      requests++;
      yield { type: "usage", input: usage.input, output: usage.output, cached: usage.cached };
      // The response boundary must work when fences and JSON arrive in separate chunks.
      for (let offset = 0; offset < response.length; offset += 7)
        yield { type: "text", delta: response.slice(offset, offset + 7) };
      yield { type: "done", reason: "end" };
    },
  };
  const target: InferenceTarget = {
    provider,
    providerId: "test",
    model: "test",
    price: () => usage.costUsd,
  };
  return { target, requests: () => requests };
}

test.each([
  ["raw JSON", json],
  ["JSON fence", `\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060`],
  ["unlabelled fence", `\u0060\u0060\u0060\n${json}\n\u0060\u0060\u0060`],
  ["CommonMark tilde fence", `~~~json\n${json}\n~~~`],
  ["CRLF and whitespace", ` \r\n\u0060\u0060\u0060json\r\n${json}\r\n\u0060\u0060\u0060\r\n `],
  ["BOM and whitespace", `\ufeff \n${json}\n`],
])("Twin accepts %s without changing the user's voice", async (_name, response) => {
  const f = fixture(response);
  const result = await delegate(f.target, input, [], new AbortController().signal);
  expect(result).toMatchObject({ ...decision, usage });
  expect(f.requests()).toBe(1);
});

test.each([
  ["empty answer", ""],
  ["truncated JSON", `\u0060\u0060\u0060json\n{"verdict":`],
  ["multiple objects", `${json}\n${json}`],
  ["ambiguous code blocks", `~~~json\n${json}\n~~~\n~~~json\n${json}\n~~~`],
  ["prose around code", `I changed my mind.\n~~~json\n${json}\n~~~`],
  ["another language", `~~~javascript\n${json}\n~~~`],
  ["schema mismatch", '{"verdict":"pass"}'],
  ["invalid bracket escape", json.replace("checkout", String.raw`\]`)],
  ["invalid letter escape", json.replace("checkout", String.raw`\q`)],
  ["incomplete Unicode escape", json.replace("checkout", String.raw`\u12`)],
  ["literal newline in a string", json.replace("checkout", "check\nout")],
  ["unescaped inner quote", json.replace("checkout", '"checkout"')],
  ["unknown citation", JSON.stringify({ ...decision, entryIds: ["invented"] })],
])("Twin rejects %s while retaining billed usage", async (_name, response) => {
  const f = fixture(response);
  const error = await delegate(f.target, input, [], new AbortController().signal).catch(
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(TwinInferenceError);
  expect((error as TwinInferenceError).usage).toEqual(usage);
  expect(f.requests()).toBe(1);
});

test("An already cancelled Twin request never opens a provider stream", async () => {
  const f = fixture(json);
  const signal = AbortSignal.abort(new Error("Cancelled"));
  await expect(delegate(f.target, input, [], signal)).rejects.toThrow("Cancelled");
  expect(f.requests()).toBe(0);
});

test("Twin agent selectively inspects indexed messages with base tools during training", async () => {
  const toolOutputs: string[] = [];
  let turn = 0;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(req) {
      turn += 1;
      if (turn === 1) {
        const names = req.tools.map((t) => t.name);
        expect(names).toEqual(["read", "grep", "glob", "inspect_messages"]);
        yield {
          type: "tool_call",
          id: "tc-1",
          name: "inspect_messages",
          args: { ids: ["msg-30"] },
        };
        yield { type: "usage", input: 40, output: 12, cached: 0 };
        yield { type: "done", reason: "tool_use" };
        return;
      }
      const toolMsg = req.messages.find((m) => m.role === "tool");
      if (toolMsg && "content" in toolMsg) toolOutputs.push(String(toolMsg.content));
      yield {
        type: "text",
        delta: JSON.stringify({
          candidates: [
            {
              kind: "preference",
              reaction: "anger",
              strength: 3,
              voice: "Никаких модалок, только инлайн!",
              summary: "Inline UI over modals",
              content: "Always use inline editing instead of modals.",
              appliesWhen: "Building forms",
              evidence: [{ sourceMessageId: "msg-30", quote: "Никаких модалок, только инлайн!" }],
            },
          ],
        }),
      };
      yield { type: "usage", input: 55, output: 28, cached: 0 };
      yield { type: "done", reason: "end" };
    },
  };
  const messages: SourceMessage[] = Array.from({ length: 30 }, (_, idx) => ({
    id: `msg-${idx + 1}`,
    sourceId: "flecten",
    sessionId: "ses-1",
    reference: `events.jsonl:${idx + 1}`,
    text: idx + 1 === 30 ? "Никаких модалок, только инлайн!" : `Prompt ${idx + 1}`,
    digest: `dig-${idx + 1}`,
  }));
  const result = await learn(
    { provider, providerId: "test", model: "test", price: () => 0.002 },
    messages,
    [],
    [],
    new AbortController().signal,
    { cwd: process.cwd(), messages },
  );
  expect(toolOutputs[0]).toContain("Никаких модалок, только инлайн!");
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.voice).toBe("Никаких модалок, только инлайн!");
  expect(result.usage.input).toBe(95);
});
