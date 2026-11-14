import { describe, expect, test } from "bun:test";
import { parseSse } from "../../src/providers/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("SSE parser", () => {
  test.each(["\n", "\r\n", "\r"])(
    "handles %j line endings across every chunk boundary",
    async (ending) => {
      const text = ["event: message", "data: one", "data: two", "", "data: next", "", ""].join(
        ending,
      );
      for (let split = 0; split <= text.length; split += 1) {
        const messages = [];
        for await (const message of parseSse(streamOf([text.slice(0, split), text.slice(split)]))) {
          messages.push(message);
        }
        expect(messages).toEqual([
          { event: "message", data: "one\ntwo" },
          { event: "", data: "next" },
        ]);
      }
    },
  );

  test("parses events split across chunks", async () => {
    const messages = [];
    for await (const message of parseSse(
      streamOf(['event: message\ndata: {"a":', "1}\n\n", "data: second\n\n"]),
    )) {
      messages.push(message);
    }
    expect(messages).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "", data: "second" },
    ]);
  });

  test("joins multi-line data", async () => {
    const messages = [];
    for await (const message of parseSse(streamOf(["data: one\ndata: two\n\n"]))) {
      messages.push(message);
    }
    expect(messages[0]?.data).toBe("one\ntwo");
  });

  test("ignores comments and handles CRLF", async () => {
    const messages = [];
    for await (const message of parseSse(streamOf([": keepalive\r\ndata: x\r\n\r\n"]))) {
      messages.push(message);
    }
    expect(messages).toEqual([{ event: "", data: "x" }]);
  });
});
