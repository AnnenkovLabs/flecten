import { expect, test } from "bun:test";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Event, ToolResult } from "../../src/core/types";
import { ModuleActionSchema } from "../../src/modules/actions";
import { readModule } from "../../src/modules/package";
import { moduleFixture, type ProviderInput } from "../helpers/modules";

const prefix = "mcp_module_computer-use__runtime_";
function talker(input: ProviderInput): boolean {
  return (input.tools as Array<{ function: { name: string } }>).some(
    (tool) => tool.function.name === "worker",
  );
}
function snapshot(result: ToolResult) {
  return (
    result.data as {
      structuredContent: {
        state: string;
        control: string;
        observation: { id: string; width: number; height: number } | null;
      };
    }
  ).structuredContent;
}
async function within<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(8000).then(() => {
      throw new Error("Computer conversation event timed out");
    }),
  ]);
}

test("conversation surface and Worker share one computer and human takeover stops Worker input", async () => {
  if (process.platform !== "linux" || !Bun.which("Xvfb")) return;
  const f = await moduleFixture({ conversation: true });
  const act = Promise.withResolvers<void>();
  const inspectStopped = Promise.withResolvers<void>();
  const started = Promise.withResolvers<ToolResult>();
  const acted = Promise.withResolvers<ToolResult>();
  const stopped = Promise.withResolvers<ToolResult>();
  const finished = Promise.withResolvers<void>();
  const sessionId = "shared-computer";
  let observationId = "";
  let workerTurn = 0;
  let talkerTurn = 0;
  const events: Event[] = [];
  try {
    await cp(join(import.meta.dir, "../../src/marketplace/modules/computer-use"), f.root, {
      recursive: true,
    });
    const source = await readModule(f.root);
    await f.app.acceptTrust();
    await f.app.modules.change({ operation: "trust", path: f.root, revision: source.revision });
    await f.app.modules.change({ operation: "interface", path: f.root, enabled: true });
    f.app.session.subscribe((event) => {
      events.push(event);
      if (event.type !== "worker.event") return;
      if (event.event.type === "session.finished") finished.resolve();
      if (event.event.type !== "tool.finished") return;
      const { call, result } = event.event;
      if (call.name !== "module") return;
      const action = ModuleActionSchema.parse(call.args);
      if (action.operation !== "call") return;
      if (action.tool === `${prefix}start`) started.resolve(result);
      if (action.tool === `${prefix}act`) acted.resolve(result);
      if (action.tool === `${prefix}status`) stopped.resolve(result);
    });
    const call = (tool: string, args: Record<string, unknown> = {}) => ({
      name: "module",
      args: { operation: "call", name: "computer-use", tool: `${prefix}${tool}`, arguments: args },
    });
    f.script(async (input) => {
      if (talker(input)) {
        if (talkerTurn++ === 0)
          return { name: "worker", args: { operation: "start", task: "Inspect the computer." } };
        return "Computer task delegated.";
      }
      switch (workerTurn++) {
        case 0:
          return { name: "module", args: { operation: "activate", name: "computer-use" } };
        case 1:
          return call("start", { width: 800, height: 600 });
        case 2:
          await act.promise;
          return call("act", {
            observationId,
            action: { type: "wait", durationMs: 0 },
            reason: "Verify current control owner.",
          });
        case 3:
          await inspectStopped.promise;
          return call("status");
        default:
          return "<complete>Verified.</complete>";
      }
    });
    await f.app.session.send({ type: "run", sessionId, prompt: "Use the computer." });
    const workerStart = snapshot(await within(started.promise));
    const invoke = async (tool: string, args: Record<string, unknown> = {}) =>
      (await f.app.session.send({
        type: "modules.invoke",
        sessionId,
        input: {
          name: "computer-use",
          surface: "desktop",
          revision: source.revision,
          request: {
            type: "flecten.module.request",
            id: crypto.randomUUID(),
            method: "call",
            tool: `${prefix}${tool}`,
            arguments: args,
          },
        },
      })) as ToolResult;
    const visible = await invoke("status");
    expect(visible.ok).toBe(true);
    expect(snapshot(visible).observation?.id).toBe(workerStart.observation?.id);
    expect(snapshot(visible).state).toBe("ready");
    expect(await readdir(join(f.cwd, ".liquid/module-runtime"))).toHaveLength(1);
    expect((await f.app.modules.state("unrelated-chat")).active).toEqual([]);
    expect((await f.app.modules.state(`${sessionId}_worker`)).active).toEqual(
      (await f.app.modules.state(sessionId)).active,
    );
    const handed = await invoke("control", { operation: "take_over" });
    expect(handed.ok).toBe(true);
    observationId = snapshot(handed).observation?.id ?? "";
    act.resolve();
    const blocked = await within(acted.promise);
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain("human has control");
    expect((await invoke("control", { operation: "stop" })).ok).toBe(true);
    inspectStopped.resolve();
    expect(snapshot(await within(stopped.promise)).state).toBe("stopped");
    await within(finished.promise);
    const child = events.find((event) => event.type === "worker.event");
    expect(child?.type === "worker.event" && child.event.sessionId).toBe(`${sessionId}_worker`);
    await f.app.modules.runtime.close(`${sessionId}_worker`);
    expect(snapshot(await invoke("status")).state).toBe("stopped");
    await f.app.session.close(sessionId);
    expect(await readdir(join(f.cwd, ".liquid/module-runtime"))).toEqual([]);
    const reopened = await invoke("status");
    expect(reopened.ok).toBe(true);
    expect(snapshot(reopened).state).toBe("idle");
    expect(await readdir(join(f.cwd, ".liquid/module-runtime"))).toHaveLength(1);
  } finally {
    act.resolve();
    inspectStopped.resolve();
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
}, 20_000);

test("Talker exposes module inspection without activation, invocation or deactivation", async () => {
  const f = await moduleFixture({ conversation: true });
  const results: ToolResult[] = [];
  try {
    await f.app.acceptTrust();
    f.app.session.subscribe((event) => {
      if (event.type === "tool.finished") results.push(event.result);
    });
    const actions = [
      { operation: "list" },
      { operation: "activate", name: "studio" },
      { operation: "call", name: "studio", tool: "measure", arguments: { seconds: 1 } },
      { operation: "deactivate", name: "studio" },
    ];
    f.script((_input, index) => {
      const args = actions[index];
      return args ? { name: "module", args } : "Inspection finished.";
    });
    await f.app.session.send({ type: "run", sessionId: "inspection", prompt: "Inspect modules." });
    expect(results.map((result) => result.ok)).toEqual([true, false, false, false]);
    expect((await f.app.modules.state("inspection")).active).toEqual([]);
    const tool = (
      (f.requests[0]?.tools ?? []) as Array<{
        function: {
          name: string;
          parameters: { oneOf: Array<{ properties: { operation: { const: string } } }> };
        };
      }>
    ).find((tool) => tool.function.name === "module");
    expect(tool?.function.parameters.oneOf.map((item) => item.properties.operation.const)).toEqual([
      "list",
      "status",
      "tools",
      "read",
    ]);
  } finally {
    await f.close();
    await rm(f.cwd, { recursive: true, force: true });
  }
});
