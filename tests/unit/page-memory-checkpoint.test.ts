import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type ContextMessage, PROFILE_4 } from "../../src/context";
import { PageWriter } from "../../src/core/pages/writer";
import { scriptedProvider } from "../helpers/fake-provider";

const SUMMARY = {
  progress: "kept the public API",
  locations: "src/helper.ts",
  instructions: "only fix empty input",
  nextSteps: "run the targeted check",
  risks: "none",
};
const MESSAGES: ContextMessage[] = [{ role: "user", content: "Always use concise answers" }];
const CANDIDATE = { text: "The user prefers concise answers", quote: MESSAGES[0]?.content };
const CANDIDATE_SCHEMA = z.object({ text: z.string(), quote: z.string() }).strict();

async function checkpointRun(response: unknown, capture?: () => Promise<void>, enabled = true) {
  const provider = scriptedProvider([
    [
      { type: "text", delta: JSON.stringify(response) },
      { type: "done", reason: "end" },
    ],
  ]);
  const captured: { value: unknown; messages: readonly ContextMessage[] }[] = [];
  const failures: unknown[] = [];
  const writer = new PageWriter({
    provider,
    maxOutputTokens: 2000,
    contextWindow: 50_000,
    ...(enabled
      ? {
          memoryCheckpoint: {
            schema: CANDIDATE_SCHEMA,
            instructions: "Save only durable, source-backed corrections in memoryCandidates.",
            async capture(value: unknown, messages: readonly ContextMessage[]) {
              await capture?.();
              captured.push({ value, messages });
            },
            failed: (error: unknown) => failures.push(error),
          },
        }
      : {}),
  });
  await writer.write(MESSAGES, { profile: PROFILE_4, targetTokens: 4000 });
  return { writer, provider, captured, failures };
}

describe("page memory checkpoint", () => {
  test("captures candidates in the existing summary request and preserves the five-field page", async () => {
    const { writer, provider, captured, failures } = await checkpointRun({
      ...SUMMARY,
      memoryCandidates: [CANDIDATE],
    });
    expect(writer.last?.source).toBe("model");
    expect(writer.last?.contextSummary.fields.next).toBe(SUMMARY.nextSteps);
    expect(writer.last?.markdown).not.toContain("memoryCandidates");
    expect(captured).toEqual([{ value: [CANDIDATE], messages: MESSAGES }]);
    expect(failures).toEqual([]);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.system).toContain('"memoryCandidates"');
    expect(provider.requests[0]?.system).toContain("source-backed corrections");
  });

  test("omitted or empty candidates are a successful no-op", async () => {
    for (const response of [SUMMARY, { ...SUMMARY, memoryCandidates: [] }]) {
      const { writer, captured, failures } = await checkpointRun(response);
      expect(writer.last?.source).toBe("model");
      expect(captured).toEqual([]);
      expect(failures).toEqual([]);
    }
  });

  test("invalid candidates cannot discard a valid summary or fail silently", async () => {
    for (const memoryCandidates of [[{ text: "missing source" }], Array(4).fill(CANDIDATE)]) {
      const { writer, captured, failures } = await checkpointRun({ ...SUMMARY, memoryCandidates });
      expect(writer.last?.source).toBe("model");
      expect(captured).toEqual([]);
      expect(failures).toHaveLength(1);
    }
  });

  test("a persistence failure is reported while the valid continuation survives", async () => {
    const failure = new Error("memory persistence failed");
    const { writer, captured, failures } = await checkpointRun(
      { ...SUMMARY, memoryCandidates: [CANDIDATE] },
      async () => {
        throw failure;
      },
    );
    expect(writer.last?.source).toBe("model");
    expect(captured).toEqual([]);
    expect(failures).toEqual([failure]);
  });

  test("an invalid summary cannot commit memories", async () => {
    const { writer, captured } = await checkpointRun({
      ...SUMMARY,
      progress: "",
      memoryCandidates: [CANDIDATE],
    });
    expect(writer.last?.source).toBe("deterministic");
    expect(captured).toEqual([]);
  });

  test("the response schema stays unchanged when the checkpoint is absent", async () => {
    const { writer, provider } = await checkpointRun(SUMMARY, undefined, false);
    expect(writer.last?.source).toBe("model");
    expect(provider.requests[0]?.system).not.toContain("memoryCandidates");
    const unexpected = await checkpointRun(
      { ...SUMMARY, memoryCandidates: [CANDIDATE] },
      undefined,
      false,
    );
    expect(unexpected.writer.last?.source).toBe("deterministic");
  });
});
