import { describe, expect, test } from "bun:test";
import { parseAgentOne } from "../../src/providers/agent-one";
import {
  familyFirstVersion,
  usesCompletionTokens,
  versionFirstVersion,
} from "../../src/providers/model-family";
import {
  alphanumericLower,
  dashSlug,
  isIPv4,
  oneLine,
  trimTrailingSlashes,
  withoutPrefix,
} from "../../src/util/text";

/** One script chunk of a Next.js page, the way the list ships its data. */
function flight(payload: string): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}

describe("model family versions", () => {
  test("reads family-first ids, dated or not", () => {
    expect(familyFirstVersion("claude-sonnet-4-5-20250929")).toEqual({ major: 4, minor: 5 });
    expect(familyFirstVersion("claude-opus-4-20250514")).toEqual({ major: 4, minor: 20250514 });
    expect(familyFirstVersion("anthropic/claude-haiku-4")).toEqual({ major: 4 });
    expect(familyFirstVersion("claude-sonnet")).toBeUndefined();
  });

  test("reads the older version-first order", () => {
    expect(versionFirstVersion("claude-3-5-sonnet-20241022")).toEqual({ major: 3, minor: 5 });
    expect(versionFirstVersion("claude-3-opus-20240229")).toEqual({ major: 3 });
    expect(versionFirstVersion("claude-3-5-unknown")).toBeUndefined();
    expect(versionFirstVersion("gpt-4o")).toBeUndefined();
  });

  test("picks the OpenAI families that take max_completion_tokens", () => {
    expect(["gpt-5", "gpt-5.1-mini", "o1", "o3-mini", "o4-mini"].every(usesCompletionTokens)).toBe(
      true,
    );
    expect(["gpt-4o", "gpt-4.1", "omni-x", "o", "llama-3"].some(usesCompletionTokens)).toBe(false);
  });
});

describe("text helpers", () => {
  test("normalize without regular expressions", () => {
    expect(trimTrailingSlashes("https://api.x.ai/v1///")).toBe("https://api.x.ai/v1");
    expect(withoutPrefix("models/gemini-2.5", "models/")).toBe("gemini-2.5");
    expect(withoutPrefix("gemini", "models/")).toBe("gemini");
    expect(isIPv4("127.0.0.1")).toBe(true);
    expect(isIPv4("127.0.0")).toBe(false);
    expect(isIPv4("1.2.3.x")).toBe(false);
    expect(alphanumericLower("GPT-4.1 mini")).toBe("gpt41mini");
    expect(dashSlug("  My Provider (EU) ")).toBe("my-provider-eu");
    expect(oneLine("  a\n\t b  c \r\n")).toBe("a b c");
  });
});

describe("agent-one list", () => {
  test("decodes script chunks split mid-object and merges listings of one model", () => {
    const provider = JSON.stringify({
      id: "openai",
      models: {
        "gpt-5": {
          id: "gpt-5",
          name: "GPT-5",
          features: { reasoning: true, tool_call: true, attachment: true },
          limit: { context: 400_000, output: 128_000 },
        },
      },
    });
    const bare = JSON.stringify({
      id: "gpt-5",
      features: { tool_call: true },
      limit: { context: 272_000, output: 128_000 },
    });
    const html = [
      flight(`1:["$","div",null,${provider.slice(0, 40)}`),
      flight(`${provider.slice(40)}]\n2:${bare}`),
      flight('3:{"id":"no-limits","name":"Ignored"}'),
    ].join("\n");
    const models = parseAgentOne(html);
    expect(Object.keys(models)).toEqual(["gpt-5"]);
    expect(models["gpt-5"]).toMatchObject({
      name: "GPT-5",
      context: 400_000,
      output: 128_000,
      reasoning: true,
      tools: true,
      vision: true,
      source: "agent-one",
    });
  });

  test("ids inside strings are not models and broken chunks are skipped", () => {
    const text = JSON.stringify({ id: "note", text: 'see {"id":"fake","limit":{"context":1}}' });
    const html = [
      flight(text),
      '<script>self.__next_f.push([1,"unterminated',
      flight('{"id":"real","limit":{"context":8192}}'),
    ].join("\n");
    expect(Object.keys(parseAgentOne(html))).toEqual([]);
    expect(Object.keys(parseAgentOne(flight('{"id":"real","limit":{"context":8192}}')))).toEqual([
      "real",
    ]);
  });
});
