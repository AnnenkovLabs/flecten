import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextWindow, maxOutputTokens, modelContext } from "../../src/app/provider-state";
import { defaultConfig } from "../../src/config/defaults";
import { migrateConfig } from "../../src/config/migrate";
import { HarnessConfigSchema } from "../../src/config/schema";
import { contextEstimate } from "../../src/core/loop/context";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { settingsIssue } from "../../ui/src/lib/settings/validation";
import type { HarnessSettings } from "../../ui/src/lib/types";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function session(provider: ModelProvider, overrides = {}) {
  const config = defaultConfig();
  const cwd = await mkdtemp(join(tmpdir(), "flecten-autonomous-"));
  dirs.push(cwd);
  await Bun.write(join(cwd, "README.md"), "test");
  return createSession({
    cwd,
    provider,
    providerId: provider.id,
    model: provider.model,
    system: "test",
    tools: new ToolRegistry(builtinTools(), { limits: config.tools }),
    limits: config.tools,
    maxOutputTokens: 1000,
    context: { window: 1_000_000, reserve: 1000 },
    loop: config.loop,
    logDir: (id) => join(cwd, ".flecten", "sessions", id, "logs"),
    ...overrides,
  });
}

describe("autonomous settings", () => {
  test("completes past the old 100-turn ceiling", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "long",
      model: "long",
      async *stream(): AsyncIterable<ModelEvent> {
        calls += 1;
        if (calls > 107) throw new Error("completion did not terminate the run");
        if (calls <= 105) {
          yield {
            type: "tool_call",
            id: `read-${calls}`,
            name: "read",
            args: { path: "README.md" },
          };
          yield { type: "done", reason: "tool_use" };
        } else {
          yield {
            type: "tool_call",
            id: "done",
            name: "done",
            args: { summary: "complete", evidence: ["README read 105 times"] },
          };
          yield { type: "done", reason: "tool_use" };
        }
      },
    };
    const handle = await session(provider);
    const result = (await handle.send({ type: "run", prompt: "Read and finish" })) as RunResult;
    expect(result.stopReason).toBe("done");
    expect(result.turns).toBe(106);
    expect(calls).toBe(106);
  });

  test("an unlimited run still stops empty responses and honors a budget", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "empty",
      model: "empty",
      async *stream(): AsyncIterable<ModelEvent> {
        calls += 1;
        yield { type: "usage", input: 10, output: 1, cached: 0 };
        yield { type: "done", reason: "end" };
      },
    };
    const handle = await session(provider);
    const result = (await handle.send({ type: "run", prompt: "hello" })) as RunResult;
    expect(result.stopReason).toBe("end");
    expect(calls).toBe(9);
    const budgeted = await session(provider, { budgets: { maxTokens: 10 } });
    const stopped = (await budgeted.send({ type: "run", prompt: "hello" })) as RunResult;
    expect(stopped.stopReason).toBe("budget");
    expect(calls).toBe(10);
  });

  test("uses native model output with a separate reply reserve; explicit limits still apply", () => {
    const config = defaultConfig();
    const provider = config.providers[config.provider];
    if (!provider) throw new Error("default provider missing");
    provider.models[config.model] = {
      context: 1_000_000,
      output: 128_000,
    };
    expect(maxOutputTokens(config)).toBe(128_000);
    expect(contextWindow(config)).toBe(1_000_000);
    expect(modelContext(config).reserve).toBe(config.context.reserve);
    config.maxOutputTokens = 4096;
    expect(maxOutputTokens(config)).toBe(4096);
    config.maxOutputTokens = 0;
    provider.maxOutputTokens = 8192;
    expect(maxOutputTokens(config)).toBe(8192);
  });

  test("a large native output limit does not consume the million-token input window", () => {
    const config = defaultConfig();
    const provider = config.providers[config.provider];
    if (!provider) throw new Error("default provider missing");
    provider.models[config.model] = { context: 1_048_576, output: 943_718 };
    const context = modelContext(config);
    expect(context.window).toBe(1_048_576);
    expect(context.window - context.reserve).toBe(1_032_576);
    expect(maxOutputTokens(config)).toBe(943_718);
  });

  test("long input reaches the model without early compaction and the reply fits remaining context", async () => {
    const config = defaultConfig();
    const definition = config.providers[config.provider];
    if (!definition) throw new Error("default provider missing");
    definition.models[config.model] = { context: 1_048_576, output: 943_718 };
    const provider = scriptedProvider([
      [
        { type: "text", delta: "Complete." },
        { type: "done", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry([], { limits: config.tools });
    const events: Event[] = [];
    const handle = await session(provider, {
      tools,
      maxOutputTokens: maxOutputTokens(config),
      context: modelContext(config),
      loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    });
    handle.subscribe((event) => events.push(event));
    try {
      await handle.send({ type: "run", prompt: "context ".repeat(80_000) });
      expect(provider.requests).toHaveLength(1);
      const request = provider.requests[0];
      if (!request) throw new Error("model request missing");
      const used = contextEstimate(request.system, request.messages, tools);
      expect(used).toBeGreaterThan(104_858);
      expect(request.maxTokens).toBe(1_048_576 - used);
      expect(request.maxTokens).toBeLessThan(943_718);
      expect(events.some((event) => event.type === "context.compacted")).toBe(false);
      expect(events.find((event) => event.type === "context.usage")).toMatchObject({
        window: 1_048_576,
        reserve: 16_000,
      });
      handle.update({ context: { window: 2_000_000, reserve: 32_000 } });
      expect(await handle.send({ type: "status" })).toMatchObject({
        context: { used, window: 2_000_000, reserve: 32_000 },
      });
    } finally {
      await handle.dispose();
    }
  });

  test("migrates shipped ceilings and preserves deliberate limits and permissions", () => {
    const legacy = {
      schemaVersion: 2,
      maxOutputTokens: 16_384,
      loop: { maxTurns: 100, continuations: 2, parallelTools: true },
      permissions: { shell: "ask" },
    };
    const migrated = HarnessConfigSchema.parse(migrateConfig(legacy));
    expect(migrated.maxOutputTokens).toBe(0);
    expect(migrated.loop).toEqual({ maxTurns: 0, continuations: 8, parallelTools: true });
    expect(migrated.permissions?.shell).toBe("ask");
    expect(legacy.loop.maxTurns).toBe(100);
    const deliberate = HarnessConfigSchema.parse(
      migrateConfig({
        schemaVersion: 2,
        maxOutputTokens: 4096,
        loop: { maxTurns: 12, continuations: 3, parallelTools: false },
      }),
    );
    expect(deliberate.maxOutputTokens).toBe(4096);
    expect(deliberate.loop).toEqual({ maxTurns: 12, continuations: 3, parallelTools: false });
    expect(
      HarnessConfigSchema.parse(migrateConfig({ schemaVersion: 3, loop: { maxTurns: 100 } })).loop
        .maxTurns,
    ).toBe(100);
  });

  test("validates terminal fields without blocking automatic output", () => {
    const config = defaultConfig() as HarnessSettings;
    expect(settingsIssue(config)).toBe("");
    if (!config.terminal) throw new Error("default terminal missing");
    config.terminal.commandTimeoutMs = 900_000;
    expect(settingsIssue(config)).toContain("Ожидание команды");
  });
});
