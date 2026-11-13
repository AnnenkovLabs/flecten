import { Worker } from "node:worker_threads";
import { z } from "zod";

// Keep user-supplied regular expressions off the sidecar event loop. Terminating
// the worker also interrupts a RegExp that never returns to JavaScript.
const SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
let expression;
try { expression = new RegExp(workerData.pattern, workerData.flags); parentPort.postMessage({ ready: true }); }
catch (error) { parentPort.postMessage({ error: String(error.message) }); }
parentPort.on("message", (lines) => {
  if (!expression) return;
  const indices = [];
  for (let index = 0; index < lines.length; index++) {
    if (expression.test(lines[index])) indices.push(index);
  }
  parentPort.postMessage({ indices });
});
`;

const Reply = z.union([
  z.object({ indices: z.array(z.number().int().nonnegative()) }).strict(),
  z.object({ error: z.string() }).strict(),
  z.object({ ready: z.literal(true) }).strict(),
]);

export function createLineMatcher(pattern: string, caseSensitive: boolean, signal: AbortSignal) {
  const worker = new Worker(SOURCE, {
    eval: true,
    workerData: { pattern, flags: caseSensitive ? "" : "i" },
  });
  let failure: Error | undefined;
  const readiness = Promise.withResolvers<void>();
  let pending: { resolve(value: number[]): void; reject(error: Error): void } | undefined;
  const fail = (error: Error): void => {
    failure = error;
    readiness.reject(error);
    pending?.reject(error);
    pending = undefined;
  };
  worker.on("message", (value: unknown) => {
    const parsed = Reply.safeParse(value);
    if (!parsed.success) return fail(new Error("Invalid search worker response"));
    if ("error" in parsed.data) return fail(new Error(parsed.data.error));
    if ("ready" in parsed.data) return readiness.resolve();
    pending?.resolve(parsed.data.indices);
    pending = undefined;
  });
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (pending) fail(new Error(`Search worker exited with code ${code}`));
  });
  const abort = (): void => {
    fail(new Error("Search aborted"));
    void worker.terminate();
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  return {
    ready: readiness.promise,
    match(lines: string[]): Promise<number[]> {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        worker.postMessage(lines);
      });
    },
    async close(): Promise<void> {
      signal.removeEventListener("abort", abort);
      await worker.terminate();
    },
  };
}
