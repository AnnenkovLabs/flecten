import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextWindow, maxOutputTokens, modelContext } from "../../src/app/provider-state";
import { defaultConfig } from "../../src/config/defaults";
import { migrateConfig } from "../../src/config/migrate";
import { HarnessConfigSchema } from "../../src/config/schema";
import { createSession } from "../../src/core/session/session";
import type { RunResult } from "../../src/core/types";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { settingsIssue } from "../../ui/src/lib/settings/validation";
import type { HarnessSettings } from "../../ui/src/lib/types";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function session(provider: ModelProvider, overrides = {}) {
  const config = defaultConfig();
  const cwd = await mkdtemp(join(tmpdir(), "liquid-autonomous-"));
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
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
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

  test("uses native model output and reserves room for it; explicit limits still apply", () => {
    const config = defaultConfig();
    const provider = config.providers[config.provider];
    if (!provider) throw new Error("default provider missing");
    provider.models[config.model] = {
      context: 1_000_000,
      output: 128_000,
    };
    expect(maxOutputTokens(config)).toBe(128_000);
    expect(contextWindow(config)).toBe(1_000_000);
    expect(modelContext(config).reserve).toBe(128_000);
    config.maxOutputTokens = 4096;
    expect(maxOutputTokens(config)).toBe(4096);
    config.maxOutputTokens = 0;
    provider.maxOutputTokens = 8192;
    expect(maxOutputTokens(config)).toBe(8192);
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
