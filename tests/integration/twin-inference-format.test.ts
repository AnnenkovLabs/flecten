import { expect, test } from "bun:test";
import type { ModelProvider } from "../../src/providers/types";
import { delegate, type InferenceTarget } from "../../src/twin/inference";
import { TwinInferenceError } from "../../src/twin/inference-error";

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
