import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createConversation } from "../../src/app/conversation";
import { SessionLogs } from "../../src/app/session-logs";
import { workerTool } from "../../src/app/worker-tool";
import {
  createSession,
  type SessionHandle,
  type SessionOptions,
} from "../../src/core/session/session";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { readSession } from "../../src/store/events/read";
import { ToolRegistry } from "../../src/tools/registry";
import { taskTool } from "../../src/tools/task/run";
import { scriptedProvider } from "../helpers/fake-provider";

const fixtures: { cwd: string; session: SessionHandle; logs: SessionLogs }[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    try {
      await f.session.dispose();
    } finally {
      await f.logs.closeAll();
      await rm(f.cwd, { recursive: true, force: true });
    }
  }
});
const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};

for (const mode of ["graceful", "force"] as const)
  for (const owner of ["agent", "conversation", "worker"] as const) {
    const conversation = owner !== "agent";
    test(`${owner} ${mode} stop leaves children alive and each can stop separately`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), "subagent-lifetime-"));
      const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      const signals: AbortSignal[] = [];
      const ready = Promise.withResolvers<void>();
      const events: Event[] = [];
      const logs = new SessionLogs(cwd, () => []);
      const tools = new ToolRegistry([taskTool], { limits });
      const runtime = createSubagentRuntime({
        specs: [
          {
            id: "scout",
            name: "Scout",
            description: "test",
            systemPrompt: "test",
            allowedTools: [],
            permissions: [],
            budget: { maxTurns: 3, maxTokens: 1000 },
            resultSchema: z.object({ summary: z.string() }),
          },
        ],
        runChild: async (request) => {
          const index = signals.length;
          signals.push(request.signal);
          request.onEvent?.({
            type: "reasoning.delta",
            sessionId: `child${index}`,
            text: "Inspecting",
          });
          if (signals.length === 2) ready.resolve();
          await Promise.race([
            gates[index]?.promise,
            new Promise<void>((resolve) =>
              request.signal.addEventListener("abort", () => resolve(), { once: true }),
            ),
          ]);
          return {
            text: JSON.stringify({ summary: `Finished ${index}` }),
            usage: { input: 2, output: 3, cached: 0 },
          };
        },
      });
      const scripts: ModelEvent[][] = [
        [
          ...[0, 1].map((i) => ({
            type: "tool_call" as const,
            id: `task${i}`,
            name: "task",
            args: { agent: "scout", prompt: `Work ${i}` },
          })),
          { type: "done", reason: "tool_use" },
        ],
        [
          { type: "text", delta: "Stopped waiting" },
          { type: "done", reason: "end" },
        ],
      ];
      const provider = scriptedProvider(scripts);
      const options: SessionOptions = {
        cwd,
        sessionId: "parent",
        provider,
        providerId: "test",
        model: "test",
        tools,
        system: "test",
        limits,
        maxOutputTokens: 1000,
        context: { window: 100000, reserve: 1000 },
        loop: { maxTurns: 4, continuations: 0, parallelTools: true },
        logDir: (id) => join(cwd, id, "logs"),
        subagentRunnerFactory: runtime.factory,
        onEvent: (event) => logs.persist(event),
      };
      const talker = scriptedProvider([
        [
          {
            type: "tool_call",
            id: "worker",
            name: "worker",
            args: { operation: "start", task: "Work" },
          },
          { type: "done", reason: "tool_use" },
        ],
        [
          { type: "text", delta: "Working" },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = conversation
        ? await createConversation(options, {
            events: [],
            configure: async (o, execute) => ({
              talker: {
                ...o,
                provider: talker,
                tools: new ToolRegistry([workerTool(execute)], { limits }),
                responseFormat: "conversation",
              },
              worker: { ...o, responseFormat: "structured" },
            }),
          })
        : createSession(options);
      fixtures.push({ cwd, session, logs });
      session.subscribe((event) => events.push(event));
      const run = session.send({ type: "run", prompt: "Delegate twice" });
      await ready.promise;
      await session.send({
        type: "stop",
        mode,
        ...(owner === "worker" ? { target: "worker" } : {}),
      });
      if (!conversation) expect(((await run) as RunResult).stopReason).toBe("stopped");
      else await run;
      expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
      expect(session.peek().jobs).toBeGreaterThanOrEqual(2);
      const children = events
        .flatMap((e) => (e.type === "worker.event" ? [e.event] : [e]))
        .filter((e) => e.type === "subagent.started");
      expect(children.map((e) => e.subagent.name)).toEqual(["Milo", "Lumi"]);
      expect(new Set(children.map((e) => e.subagent.avatar)).size).toBe(2);
      const first = children[0]?.subagent.id;
      if (!first) throw new Error("No child");
      expect(await session.send({ type: "subagent.stop", id: first })).toEqual({ stopped: true });
      expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
      gates[1]?.resolve();
      await new Promise<void>((resolve) => {
        const off = session.subscribe((e) => {
          const event = e.type === "worker.event" ? e.event : e;
          if (event.type === "subagent.finished" && !event.cancelled) {
            off();
            resolve();
          }
        });
      });
      const finished = events
        .flatMap((e) => (e.type === "worker.event" ? [e.event] : [e]))
        .filter((e) => e.type === "subagent.finished");
      expect(finished).toHaveLength(2);
      expect(finished.find((e) => !e.cancelled)?.result).toMatchObject({
        ok: true,
        data: { summary: "Finished 1" },
      });
      if (!conversation) {
        const second = children[1]?.subagent.id;
        if (!second) throw new Error("Missing second child");
        scripts.splice(
          1,
          1,
          [
            { type: "tool_call", id: "list", name: "task", args: { operation: "list" } },
            { type: "done", reason: "tool_use" },
          ],
          [
            {
              type: "tool_call",
              id: "wait",
              name: "task",
              args: { operation: "wait", id: second },
            },
            { type: "done", reason: "tool_use" },
          ],
          [
            { type: "text", delta: "<summary>Reports collected</summary>" },
            { type: "done", reason: "end" },
          ],
        );
        await session.send({
          type: "run",
          sessionId: "parent",
          prompt: "Collect existing reports",
        });
        const toolResults = session.getHistory().filter((message) => message.role === "tool");
        expect(toolResults.some((message) => message.content.includes('"name":"Lumi"'))).toBe(true);
        expect(
          toolResults.some((message) => message.content.includes('"summary":"Finished 1"')),
        ).toBe(true);
        expect(signals).toHaveLength(2);
      }
      await session.flush();
      const stored = (await readSession(cwd, "parent")).flatMap((e) =>
        e.type === "worker.event" ? [e.event] : [e],
      );
      expect(stored.filter((e) => e.type === "subagent.started")).toHaveLength(2);
      expect(stored.filter((e) => e.type === "subagent.finished")).toHaveLength(2);
    });
  }
