import { expect, test } from "bun:test";
import { z } from "zod";
import { deferredExtensions, registryFor } from "../../src/app/extensions";
import { subagentToolCatalog } from "../../src/app/subagents";
import { HarnessConfigSchema } from "../../src/config/schema";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import type { SubagentSpec } from "../../src/core/subagents/types";
import { taskTool } from "../../src/tools/task/run";

function role(id: string): SubagentSpec {
  return {
    id,
    name: id,
    description: `${id} project role`,
    systemPrompt: `You are ${id}.`,
    allowedTools: ["read"],
    permissions: [{ action: "read", policy: "allow" }],
    budget: { maxTurns: 2, maxTokens: 1000 },
    resultSchema: z.object({ summary: z.string() }),
  };
}

test("app registries keep independent task catalogs when created and refreshed", () => {
  const extensions = deferredExtensions({ skills: [], diagnostics: [] });
  const config = HarnessConfigSchema.parse({});
  const first = registryFor(() => extensions, config);
  const second = registryFor(() => extensions, config);
  const runChild = async (): Promise<never> => {
    throw new Error("This test does not run children.");
  };
  const original = taskTool.description;
  const firstRuntime = createSubagentRuntime({ specs: [role("alpha")], runChild });
  const secondRuntime = createSubagentRuntime({ specs: [role("beta")], runChild });

  subagentToolCatalog(first, firstRuntime);
  const firstDescription = first.specs().find((tool) => tool.name === "task")?.description;
  subagentToolCatalog(second, secondRuntime);
  const secondDescription = second.specs().find((tool) => tool.name === "task")?.description;

  expect(firstDescription).toContain('"id": "alpha"');
  expect(secondDescription).toContain('"id": "beta"');
  expect(first.get("task")?.description).toBe(firstDescription);
  expect(secondDescription).not.toContain('"id": "alpha"');
  expect(taskTool.description).toBe(original);

  subagentToolCatalog(first, createSubagentRuntime({ specs: [role("alpha-refreshed")], runChild }));
  const refreshed = first.get("task")?.description ?? "";
  expect(refreshed).toContain('"id": "alpha-refreshed"');
  expect(refreshed).not.toContain('"id": "alpha"');
  expect(refreshed.split("Available subagents:")).toHaveLength(2);
  expect(second.get("task")?.description).toBe(secondDescription);
  expect(taskTool.description).toBe(original);
});
