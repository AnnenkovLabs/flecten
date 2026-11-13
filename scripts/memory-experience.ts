import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { configSecrets } from "../src/app/provider-secrets";
import { loadConfig } from "../src/config/load";
import type { MemoryWrite } from "../src/core/memory/types";
import type { Event, RunResult } from "../src/core/types";
import { createProvider } from "../src/providers/registry";
import { PermissionEngine } from "../src/security/permissions";
import { SandboxPolicy } from "../src/security/sandbox";
import { redactKnown } from "../src/util/redact";
import { experienceScenarios } from "./memory-experience/scenarios";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    runs: { type: "string", default: "3" },
    start: { type: "string", default: "0" },
    baseline: { type: "string" },
    out: { type: "string" },
    scenario: { type: "string" },
  },
});
if (!values.live) {
  console.log(
    "Operational memory smoke. Paid requests require --live. Options: --runs 3 --baseline /path/to/source-snapshot --out /tmp/result --scenario old-cross-language-record. Below frontier benchmark floors; cannot establish a world ranking.",
  );
  process.exit(0);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("runs must be 1 through 5");
const start = Number(values.start);
if (!Number.isInteger(start) || start < 0 || start > 100)
  throw new Error("start must be 0 through 100");
const root = resolve(import.meta.dir, "..");
const config = await loadConfig(root);
const { provider } = createProvider(config);
const secrets = configSecrets(config);
const output = resolve(values.out ?? join(tmpdir(), `memory-experience-${Date.now()}`));
await mkdir(output, { recursive: true, mode: 0o700 });
const limits = {
  maxOutputBytes: 24000,
  maxOutputLines: 700,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};
const arms = values.baseline
  ? [
      { name: "v1", path: resolve(values.baseline) },
      { name: "v2", path: root },
    ]
  : [{ name: "v2", path: root }];
const scenarios = experienceScenarios().filter(
  (scenario) => !values.scenario || scenario.id === values.scenario,
);
if (!scenarios.length) throw new Error("Unknown scenario");
const samples: unknown[] = [];
for (let repetition = start; repetition < start + runs; repetition += 1) {
  for (const scenario of scenarios) {
    for (const arm of repetition % 2 === 0 ? arms : [...arms].reverse()) {
      const load = (path: string) => import(pathToFileURL(join(arm.path, path)).href);
      const [
        { createSession },
        { MemoryStore },
        { ToolRegistry },
        { builtinTools },
        { buildPrompt },
      ] = await Promise.all([
        load("src/core/session/session.ts") as Promise<
          typeof import("../src/core/session/session")
        >,
        load("src/store/memory.ts") as Promise<typeof import("../src/store/memory")>,
        load("src/tools/registry.ts") as Promise<typeof import("../src/tools/registry")>,
        load("src/tools/builtin.ts") as Promise<typeof import("../src/tools/builtin")>,
        load("src/core/prompt.ts") as Promise<typeof import("../src/core/prompt")>,
      ]);
      const cwd = await mkdtemp(join(tmpdir(), "memory-experience-"));
      const store = new MemoryStore({ cwd, secrets: () => secrets });
      const events: Event[] = [];
      const results: RunResult[] = [];
      const started = performance.now();
      let error: string | undefined;
      let artifact = "";
      let activeCount = 0;
      let promptHash = "";
      try {
        for (const record of scenario.seed) {
          const { topics: _topics, appliesWhen: _appliesWhen, ...legacy } = record;
          await store.put(arm.name === "v1" ? (legacy as MemoryWrite) : record);
        }
        const tools = new ToolRegistry(
          builtinTools().filter((tool) => ["memory", "done", "write", "read"].includes(tool.name)),
          { limits },
        );
        const prompt = await buildPrompt(cwd, {
          tools: tools.specs(),
          responseFormat: "structured",
        });
        promptHash = prompt.hash;
        for (const text of scenario.prompts) {
          const session = createSession({
            cwd,
            provider,
            providerId: config.provider,
            model: config.model,
            tools,
            memory: store,
            limits,
            system: prompt.system,
            responseFormat: "conversation",
            reasoning: "low",
            maxOutputTokens: 2400,
            context: { window: 100000, reserve: 2400 },
            loop: { maxTurns: 8, continuations: 0, parallelTools: false },
            budgets: { maxWallClockMs: 90000 },
            sandbox: new SandboxPolicy({ workspaceRoot: cwd }),
            permissions: new PermissionEngine({
              rules: [
                { action: "read", policy: "auto" },
                { action: "write", policy: "auto" },
              ],
            }),
            logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
            secrets: () => secrets,
          });
          session.subscribe((event) => events.push(event));
          try {
            results.push((await session.send({ type: "run", prompt: text })) as RunResult);
          } finally {
            await session.dispose();
          }
        }
        artifact = await readFile(join(cwd, scenario.artifact), "utf8");
        activeCount = (await store.list()).filter((record) => record.status === "active").length;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
      const pass =
        !error &&
        artifact.trim() === scenario.expected &&
        (scenario.maximumActive === undefined || activeCount <= scenario.maximumActive);
      const sample = {
        scenario: scenario.id,
        arm: arm.name,
        repetition,
        pass,
        error,
        artifact,
        activeCount,
        wallClockMs: Math.round(performance.now() - started),
        results,
        promptHash,
        inputTokens: results.reduce((sum, result) => sum + result.usage.input, 0),
        outputTokens: results.reduce((sum, result) => sum + result.usage.output, 0),
        cachedTokens: results.reduce((sum, result) => sum + result.usage.cached, 0),
        turns: results.reduce((sum, result) => sum + result.turns, 0),
        toolFailures: events.filter((event) => event.type === "tool.finished" && !event.result.ok)
          .length,
      };
      samples.push(sample);
      await writeFile(
        join(output, `${scenario.id}-${arm.name}-${repetition}.json`),
        JSON.stringify(redactKnown({ ...sample, events }, secrets), null, 2),
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          scenario: scenario.id,
          arm: arm.name,
          repetition,
          pass,
          turns: sample.turns,
          inputTokens: sample.inputTokens,
          error,
        }),
      );
    }
  }
}
const report = {
  label: "operational smoke, not a decision-grade benchmark or best-system claim",
  generatedAt: new Date().toISOString(),
  provider: config.provider,
  model: config.model,
  settings: {
    runs,
    start,
    maxTurns: 8,
    maxWallClockMs: 90000,
    maxOutputTokens: 2400,
    reasoning: "low",
  },
  fixtureHash: createHash("sha256").update(JSON.stringify(scenarios)).digest("hex"),
  caveats: [
    "Synthetic seeded memories, main model chooses retrieval and actual file tools.",
    "V1 and V2 receive equal semantic record content; new topic metadata is available only in V2.",
    "No external memory system was run. Small task set and repeats cannot establish superiority.",
  ],
  samples,
};
await writeFile(
  join(output, "report.json"),
  JSON.stringify(redactKnown(report, secrets), null, 2),
  { mode: 0o600 },
);
console.log(`Saved sanitized evidence: ${join(output, "report.json")}`);
