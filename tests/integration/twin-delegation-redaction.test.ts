import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { type TwinDelegateInput, TwinDelegateInputSchema } from "../../shared/twin";
import { projectTwin } from "../../src/app/twin";
import type { ModelProvider, ModelRequest } from "../../src/providers/types";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture(secrets: readonly string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "twin-delegation-redaction-"));
  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(request) {
      requests.push(request);
      yield {
        type: "text",
        delta: JSON.stringify({
          verdict: "pass",
          voice: "Checked the result.",
          instructions: "",
          entryIds: [],
          emotion: "calm",
        }),
      };
      yield { type: "done", reason: "end" };
    },
  };
  const twin = await projectTwin({
    cwd,
    home: cwd,
    secrets: () => secrets,
    target: () => ({ provider, providerId: "test", model: "test", price: () => undefined }),
  });
  cleanup.push(async () => {
    await twin.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  await twin.configure({ enabled: true });
  return { twin, requests };
}

function delegation(request: ModelRequest | undefined): TwinDelegateInput {
  const message = request?.messages[0];
  if (message?.role !== "user") throw new Error("Missing Twin delegation request");
  const block = fromMarkdown(message.content).children.find((node) => node.type === "code");
  if (block?.type !== "code") throw new Error("Missing delegation data block");
  return TwinDelegateInputSchema.parse(JSON.parse(block.value));
}

const base: TwinDelegateInput = {
  phase: "final",
  userMessages: ["Review the result."],
  task: "Review",
  directive: "Preserve the requested behavior.",
  evidence: [],
};
const fields = ["userMessages", "task", "directive", "evidence", "result", "question"] as const;

test("Twin handles the credential escape that previously produced Invalid escape character ]", async () => {
  const f = await fixture();
  const text = String.raw`token=abcdefghijklmnop\"`;
  const result = await f.twin.delegate(
    { ...base, userMessages: [text] },
    new AbortController().signal,
  );
  expect(result.verdict).toBe("pass");
  expect(f.requests).toHaveLength(1);
  const sent = delegation(f.requests[0]);
  expect(sent.userMessages[0]).toContain("[redacted:");
  expect(JSON.stringify(f.requests)).not.toContain("abcdefghijklmnop");
});

test.each(
  fields.flatMap(
    (field) =>
      [
        [field, true],
        [field, false],
      ] as const,
  ),
)(
  "Twin safely redacts quoted credentials in %s before inference (registered: %s)",
  async (field, registered) => {
    const secret = "abcdefghijklmnopqrstu";
    const f = await fixture(registered ? [secret] : []);
    const text = `Check this code: token="${secret}"; then keep the literal \\] and \\u1234.`;
    const input: TwinDelegateInput = {
      ...base,
      [field]: field === "userMessages" || field === "evidence" ? [text] : text,
    };
    const original = structuredClone(input);
    const result = await f.twin.delegate(input, new AbortController().signal);
    expect(result.verdict).toBe("pass");
    expect(f.requests).toHaveLength(1);
    const sent = delegation(f.requests[0]);
    const redacted = text.replace(secret, registered ? "[redacted]" : "[redacted:abcd…rstu]");
    expect(sent[field]).toEqual(
      field === "userMessages" || field === "evidence" ? [redacted] : redacted,
    );
    expect(JSON.stringify(f.requests)).not.toContain(secret);
    expect(input).toEqual(original);
  },
);

test("Twin preserves escape-heavy source text and image bytes without mutating its input", async () => {
  const f = await fixture();
  const text = String.raw`const path = "C:\\Users\\name"; const bracket = /\\]/; const unicode = "\\u1234";`;
  const image = {
    mediaType: "image/png" as const,
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    name: String.raw`review-"quoted"-\].png`,
  };
  const input: TwinDelegateInput = {
    phase: "final",
    userMessages: [text],
    task: text,
    directive: text,
    evidence: [text],
    result: text,
    question: text,
    images: [image],
  };
  const original = structuredClone(input);
  await f.twin.delegate(input, new AbortController().signal);
  expect(f.requests).toHaveLength(1);
  const { images: _images, ...expected } = input;
  expect(delegation(f.requests[0])).toEqual(expected);
  const message = f.requests[0]?.messages[0];
  if (message?.role !== "user") throw new Error("Missing Twin image request");
  expect(message.images).toEqual([image]);
  expect(message.content).not.toContain(image.data);
  expect(input).toEqual(original);
});
