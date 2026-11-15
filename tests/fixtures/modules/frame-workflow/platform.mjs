import { join } from "node:path";

export default ({ workspace, services, contracts, defineService, z }) => {
  const frames = defineService("trailer.frames@1", z.object({ seconds: z.number().positive(), fps: z.number().int().positive() }), z.object({ frames: z.number().int().nonnegative() }));
  const measure = services.require(frames);
  const briefSchema = z.object({ seconds: z.number().positive(), fps: z.number().int().positive() });
  services.replace(contracts.agent, async (prompt, options) => {
    options.signal.throwIfAborted();
    const messages = options.messages ?? [];
    messages.push({ role: "user", content: prompt, ...(options.attachments?.length ? { images: options.attachments } : {}) });
    const stopped = options.stopSignal?.aborted;
    const limited = options.budgetExhausted?.();
    const usage = { input: 0, output: 0, cached: 0 };
    if (stopped || limited) return { messages, turns: 0, stopReason: limited ? "budget" : "stopped", summary: limited ?? "", lastText: "", usage };
    const brief = briefSchema.parse(await Bun.file(join(workspace, "trailer-brief.json")).json());
    const result = await measure(brief, options.signal);
    options.signal.throwIfAborted();
    const summary = `${brief.seconds}s at ${brief.fps} fps: ${result.frames} frames.`;
    const assistant = { role: "assistant", content: summary, reasoning: "", toolCalls: [] };
    messages.push(assistant);
    options.emit({ type: "turn.started", turn: 1 });
    options.emit({ type: "message.started" });
    options.emit({ type: "message.delta", text: summary });
    options.emit({ type: "message.finished", text: summary, reasoning: "", toolCalls: [], summary, complete: true });
    options.emit({ type: "turn.finished", turn: 1, reason: "done" });
    return { messages, turns: 1, stopReason: "done", summary, lastText: summary, usage, done: { summary, evidence: ["trailer-brief.json"] } };
  });
};
