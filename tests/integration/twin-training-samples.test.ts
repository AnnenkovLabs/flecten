import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TwinSnapshotSchema } from "../../shared/twin";
import { projectTwin } from "../../src/app/twin";
import type { ModelProvider } from "../../src/providers/types";

test("Twin previews bounded real source quotes only during training and never persists them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "twin-training-samples-"));
  const source = join(cwd, ".liquid/sessions/source/events.jsonl");
  const secret = "private-training-credential-do-not-display";
  const quotes = Array.from({ length: 18 }, (_, index) =>
    index === 0 ? "Keep this exact reaction. ".repeat(180) : `Real user decision ${index}.`,
  );
  const event = (prompt: string) => JSON.stringify({ event: { type: "session.started", prompt } });
  const original = [event(`My credential is ${secret}`), ...quotes.map(event)].join("\n");
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(_request, signal) {
      entered.resolve();
      await Promise.race([
        release.promise,
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      ]);
      signal.throwIfAborted();
      yield { type: "text", delta: '{"candidates":[]}' };
      yield { type: "done", reason: "end" };
    },
  };
  const twin = await projectTwin({
    cwd,
    home: cwd,
    secrets: () => [secret],
    target: () => ({ provider, providerId: "test", model: "test", price: () => 0 }),
  });
  try {
    await mkdir(join(cwd, ".liquid/sessions/source"), { recursive: true });
    await Bun.write(source, original);
    await twin.train({ sourceIds: ["liquid"] });
    await entered.promise;
    const learning = await twin.get();
    const samples = learning.training.samples;
    expect(learning.training.state).toBe("learning");
    expect(learning.training.messages).toBe(quotes.length);
    expect(samples).toHaveLength(16);
    if (!samples) throw new Error("Training must expose real quote previews");
    expect(samples.map((sample) => sample.quote)).toEqual(
      quotes.slice(0, 16).map((quote) => quote.slice(0, 4000)),
    );
    expect(samples.every((sample) => sample.sourceId === "liquid")).toBe(true);
    expect(samples.every((sample) => sample.sessionId.length === 32)).toBe(true);
    expect(JSON.stringify(samples)).not.toContain(secret);
    expect(await Bun.file(source).text()).toBe(original);
    const stored = await Bun.file(join(cwd, ".liquid/twin.json")).json();
    expect(stored.training.samples).toBeUndefined();
    expect(
      TwinSnapshotSchema.safeParse({
        ...learning,
        training: { ...learning.training, samples: [...samples, samples[0]] },
      }).success,
    ).toBe(false);
    for (const quote of ["", "x".repeat(4001)]) {
      expect(
        TwinSnapshotSchema.safeParse({
          ...learning,
          training: { ...learning.training, samples: [{ ...samples[0], quote }] },
        }).success,
      ).toBe(false);
    }
    release.resolve();
    let finished = await twin.get();
    for (let attempt = 0; attempt < 200 && finished.training.state === "learning"; attempt++) {
      await Bun.sleep(5);
      finished = await twin.get();
    }
    expect(finished.training.state).toBe("ready");
    expect(finished.training.samples).toBeUndefined();

    entered = Promise.withResolvers<void>();
    release = Promise.withResolvers<void>();
    await Bun.write(source, `${original}\n${event("A fresh decision for the next import.")}`);
    const restarted = await twin.train({ sourceIds: ["liquid"] });
    expect(restarted.training.samples).toBeUndefined();
    await entered.promise;
    expect((await twin.get()).training.samples?.map((sample) => sample.quote)).toEqual([
      "A fresh decision for the next import.",
    ]);
    const cancelled = await twin.cancel();
    expect(cancelled.training.state).toBe("cancelled");
    expect(cancelled.training.samples).toBeUndefined();
  } finally {
    release.resolve();
    await twin.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
