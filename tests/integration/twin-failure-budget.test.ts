import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TwinActivityEvent } from "../../shared/twin-activity";
import { ConversationTwin } from "../../src/app/conversation-twin";
import { projectTwin } from "../../src/app/twin";
import type { ModelProvider } from "../../src/providers/types";
import { ToolRegistry } from "../../src/tools/registry";
import { TwinInferenceError } from "../../src/twin/inference-error";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const usage = { input: 23, output: 7, cached: 4, costUsd: 0.005 };
const valid = {
  verdict: "pass",
  voice: "Keep one checkout screen.",
  instructions: "",
  entryIds: [],
  emotion: "calm",
};

async function fixture(response: unknown, incomplete = false, hold = false) {
  const cwd = await mkdtemp(join(tmpdir(), "twin-failure-"));
  const observed = Promise.withResolvers<AbortSignal>();
  let requests = 0;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(_request, signal) {
      requests++;
      yield { type: "usage", input: usage.input, output: usage.output, cached: usage.cached };
      observed.resolve(signal);
      if (hold) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        signal.throwIfAborted();
      }
      yield {
        type: "text",
        delta: typeof response === "string" ? response : JSON.stringify(response),
      };
      yield { type: "done", reason: incomplete ? "max_tokens" : "end" };
    },
  };
  const port = await projectTwin({
    cwd,
    home: cwd,
    secrets: () => [],
    target: () => ({ provider, providerId: "test", model: "test", price: () => usage.costUsd }),
  });
  await port.configure({ enabled: true });
  const limits = {
    maxOutputBytes: 1000,
    maxOutputLines: 100,
    bashTimeoutMs: 1000,
    readLimitLines: 100,
  };
  const events: TwinActivityEvent[] = [];
  const twin = new ConversationTwin(
    port,
    {
      cwd,
      sessionId: "failure",
      provider,
      providerId: "test",
      model: "test",
      tools: new ToolRegistry([], { limits }),
      system: "test",
      limits,
      maxOutputTokens: 100,
      context: { window: 1000, reserve: 100 },
      loop: { maxTurns: 3, continuations: 0, parallelTools: false },
      budgets: { maxTokens: 30, maxCostUsd: 0.005 },
      logDir: () => join(cwd, "logs"),
    },
    (event) => events.push(event),
  );
  twin.user("One screen, no registration.");
  twin.begin("Build checkout.");
  cleanup.push(async () => {
    twin.cancel();
    await port.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    twin,
    events,
    observed,
    get requests() {
      return requests;
    },
  };
}

test.each([
  ["malformed JSON", "{", false],
  ["invalid decision schema", { ...valid, verdict: "unsupported" }, false],
  ["unknown persona citation", { ...valid, entryIds: ["invented-trait"] }, false],
  ["incomplete response", valid, true],
])(
  "Twin preserves observed usage for %s and charges it against the shared task budget",
  async (_name, response, incomplete) => {
    const f = await fixture(response, incomplete);
    const error = await f.twin.decide("prepare").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(TwinInferenceError);
    expect((error as TwinInferenceError).usage).toEqual(usage);
    expect(f.events.at(-1)?.activity).toMatchObject({
      state: "error",
      usage,
      provider: "test",
      model: "test",
    });
    expect(f.twin.remaining()).toEqual({ maxTokens: 0, maxCostUsd: 0 });
    expect(await f.twin.decide("final", { result: "Worker says finished." })).toBeUndefined();
    expect(f.events.at(-1)?.activity.state).toBe("exhausted");
    expect(f.requests).toBe(1);
  },
);

test("Cancelling a taste question aborts its real provider request and retains usage already observed", async () => {
  const f = await fixture(valid, false, true);
  const controller = new AbortController();
  const pending = f.twin.decide("question", { question: "One screen or two?" }, controller.signal);
  const signal = await f.observed.promise;
  controller.abort();
  expect(await pending).toBeUndefined();
  expect(signal.aborted).toBe(true);
  expect(f.events.at(-1)?.activity).toMatchObject({ phase: "question", state: "cancelled", usage });
  expect(f.twin.remaining()).toEqual({ maxTokens: 0, maxCostUsd: 0 });
});
