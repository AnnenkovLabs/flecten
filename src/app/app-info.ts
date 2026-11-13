import { basename } from "node:path";
import { normalizeUpdateSettings } from "../../shared/update-settings.cjs";
import { configPath } from "../config/load";
import type { HarnessConfig } from "../config/schema";
import { secretBackend } from "../config/secrets";
import type { PromptStamp } from "../core/prompt";
import type { AppExtensions } from "./extensions";
import { contextWindow, gitBranch, maxOutputTokens, providerView } from "./provider-state";
import { sandboxStatus } from "./service-policy";
import type { AppInfo, ShellCheckpointState } from "./service-types";

export interface AppInfoInput {
  cwd: string;
  config: HarnessConfig;
  cost?: number | undefined;
  trustRequired: boolean;
  trusted: boolean;
  extensions: AppExtensions;
  memoryRecords: number;
  prompt: PromptStamp;
  shell: ShellCheckpointState;
  configError: string | undefined;
}

/** The status the UI shows: project, model, providers, extensions, safety and spend. */
export function appInfo(input: AppInfoInput): AppInfo {
  const { config, extensions } = input;
  const cost = input.cost;
  return {
    cwd: input.cwd,
    configPath: configPath(input.cwd),
    project: basename(input.cwd),
    branch: gitBranch(input.cwd),
    user: process.env.USER ?? process.env.USERNAME ?? "you",
    provider: config.provider,
    model: config.model,
    contextWindow: contextWindow(config),
    maxOutputTokens: maxOutputTokens(config),
    ui: config.ui ?? { sendShortcut: "enter", followUpBehavior: "queue" },
    update: normalizeUpdateSettings(config.update),
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
    ...(config.variant ? { variant: config.variant } : {}),
    secretBackend: secretBackend(),
    trustRequired: input.trustRequired,
    trustAccepted: !input.trustRequired || input.trusted,
    providers: Object.entries(config.providers).map(([id, definition]) =>
      providerView(id, definition, id === config.provider, config.model),
    ),
    skills: {
      count: extensions.skills.skills.length,
      names: extensions.skills.skills.map((skill) => skill.name),
      diagnostics: extensions.skills.diagnostics,
    },
    mcp: { tools: extensions.mcp.tools.length, servers: extensions.mcp.statuses },
    sandbox: sandboxStatus(config),
    memory: { records: input.memoryRecords },
    system: input.prompt,
    shellCheckpoints: input.shell,
    ...(cost === undefined ? {} : { cost }),
    ...(input.configError ? { configError: input.configError } : {}),
  };
}
