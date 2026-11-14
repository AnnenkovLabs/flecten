import { join } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import type { HarnessConfig } from "./schema";

// New settings must declare whether they belong to the person or the workspace.
const scopes = {
  schemaVersion: "shared",
  useDefaults: "shared",
  provider: "shared",
  model: "shared",
  variant: "shared",
  reasoning: "shared",
  providers: "shared",
  voice: "shared",
  vision: "shared",
  translation: "shared",
  conversation: "shared",
  failover: "shared",
  transport: "shared",
  terminal: "shared",
  checkpoints: "shared",
  sessions: "shared",
  budgets: "shared",
  update: "shared",
  telemetry: "shared",
  ui: "shared",
  maxOutputTokens: "shared",
  catalog: "shared",
  context: "shared",
  loop: "shared",
  tools: "shared",
  permissions: "project",
  sandbox: "project",
  skills: "project",
  mcp: "project",
  hooks: "project",
  modules: "project",
  commands: "project",
  modes: "project",
  subagents: "project",
} satisfies Record<keyof HarnessConfig, "shared" | "project">;

export function profilePath(explicitPath?: string): string | undefined {
  if (explicitPath || productEnv("CONFIG")?.trim()) return undefined;
  const directory = productEnv("PROFILE")?.trim();
  return directory ? join(directory, "flecten.config.json") : undefined;
}

export function settingsFor(
  config: HarnessConfig,
  scope: "shared" | "project",
): Partial<HarnessConfig> {
  return Object.fromEntries(
    (Object.keys(scopes) as (keyof HarnessConfig)[])
      .filter((key) => scopes[key] === scope)
      .map((key) => [key, config[key]]),
  );
}
