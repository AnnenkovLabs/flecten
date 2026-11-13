import { z } from "zod";
import { canDescribeImages } from "../../shared/vision";
import { REASONING_EFFORTS } from "../core/types/reasoning";
import { McpHttpServerConfigSchema, McpStdioServerConfigSchema } from "../mcp/config";
import { ModulesConfigSchema } from "./modules";
import {
  BudgetsConfigSchema,
  CheckpointsConfigSchema,
  CommandsConfigSchema,
  FailoverConfigSchema,
  type FailoverTargetSchema,
  type HookCommandSchema,
  HooksConfigSchema,
  LspConfigSchema,
  ModesConfigSchema,
  type PermissionActionSchema,
  type PermissionPolicySchema,
  type PermissionRuleConfigSchema,
  PermissionsConfigSchema,
  SandboxConfigSchema,
  SessionsConfigSchema,
  SubagentsConfigSchema,
  TelemetryConfigSchema,
  TerminalConfigSchema,
  UpdateConfigSchema,
} from "./schema-sections";
import { SkillsConfigSchema } from "./skills";
import { TranslationConfigSchema } from "./translation";
import { VisionConfigSchema } from "./vision";
import { VoiceConfigSchema } from "./voice";

export * from "./schema-sections";

export const CONFIG_SCHEMA_VERSION = 3;

export const ProtocolSchema = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini",
]);

export const ReasoningEffortSchema = z.enum(REASONING_EFFORTS);

export const ReasoningModeSchema = z.enum(["effort", "budget", "toggle", "none"]);

export const ReasoningReplaySchema = z.enum(["auto", "always", "never", "alias"]);

export const ThinkingParamSchema = z.enum(["auto", "thinking", "enable_thinking", "none"]);

export const ModelCostSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});

export const ModelCompatSchema = z.object({
  reasoningReplay: ReasoningReplaySchema.optional(),
  reasoningDetails: z.enum(["auto", "always", "never"]).optional(),
  thinking: z.enum(["auto", "enabled", "disabled"]).optional(),
  thinkingParam: ThinkingParamSchema.optional(),
  thinkingKeep: z.enum(["auto", "all", "none"]).optional(),
  clearThinking: z.enum(["auto", "keep", "clear"]).optional(),
  preserveThinking: z.enum(["auto", "on", "off"]).optional(),
  promptCaching: z.boolean().optional(),
  streamUsage: z.boolean().optional(),
  strictTools: z.boolean().optional(),
});

export const ModelVariantSchema = z.object({
  name: z.string().min(1).optional(),
  reasoning: ReasoningEffortSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  cost: ModelCostSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});

export const StructuredOutputFormatSchema = z.object({
  name: z.string().min(1).max(64).default("output"),
  schema: z.record(z.string(), z.unknown()),
  strict: z.boolean().default(true),
});

export const ModelConfigSchema = z
  .object({
    name: z.string().min(1).optional(),
    apiId: z.string().min(1).optional(),
    protocol: ProtocolSchema.optional(),
    context: z.number().int().positive().optional(),
    input: z.number().int().positive().optional(),
    output: z.number().int().positive().optional(),
    tools: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    reasoningMode: ReasoningModeSchema.optional(),
    reasoningLevels: z.array(ReasoningEffortSchema).optional(),
    reasoningBudget: z.number().int().positive().optional(),
    reasoningToggle: z.boolean().optional(),
    vision: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structuredOutput: z.union([z.boolean(), StructuredOutputFormatSchema]).optional(),
    audio: z.boolean().optional(),
    pdf: z.boolean().optional(),
    computerUse: z.boolean().optional(),
    promptCache: z.boolean().optional(),
    parallelToolCalls: z.boolean().optional(),
    interleavedReasoning: z.boolean().optional(),
    maxTokensParameter: z.enum(["auto", "max_tokens", "max_completion_tokens"]).optional(),
    failoverModels: z.array(z.string().min(1)).max(16).optional(),
    disabled: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
    cost: ModelCostSchema.optional(),
    knowledge: z.string().optional(),
    releaseDate: z.string().optional(),
    openWeights: z.boolean().optional(),
    attachment: z.boolean().optional(),
    canonicalId: z.string().optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
        output: z.array(z.string()).optional(),
      })
      .optional(),
    variants: z.record(z.string(), ModelVariantSchema).optional(),
    compat: ModelCompatSchema.optional(),
    verified: z
      .object({
        text: z.boolean().optional(),
        tools: z.boolean().optional(),
        reasoning: z.boolean().optional(),
        at: z.string().optional(),
      })
      .optional(),
    source: z.string().optional(),
  })
  .superRefine((model, context) => {
    if (model.context !== undefined && model.output !== undefined && model.output > model.context) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: `output limit ${model.output} exceeds context window ${model.context}`,
      });
    }
    if (model.input !== undefined && model.context !== undefined && model.input > model.context) {
      context.addIssue({
        code: "custom",
        path: ["input"],
        message: `input limit ${model.input} exceeds context window ${model.context}`,
      });
    }
  });

export const ProviderTransportConfigSchema = z.object({
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  idleTimeoutMs: z.number().int().positive().max(600_000).optional(),
  retries: z.number().int().min(0).max(10).optional(),
});

export const TransportConfigSchema = z.object({
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  idleTimeoutMs: z.number().int().positive().max(600_000).default(60_000),
  retries: z.number().int().min(0).max(10).default(2),
});

export const ProviderConfigSchema = z
  .object({
    protocol: ProtocolSchema,
    baseUrl: z.string().min(1),
    proxy: z.string().min(1).optional(),
    transportTimeoutMs: z.number().int().positive().max(600_000).optional(),
    transport: ProviderTransportConfigSchema.optional(),
    failoverModels: z.array(z.string().min(1)).max(16).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).default({}),
    models: z.record(z.string(), ModelConfigSchema).default({}),
    reasoningReplay: ReasoningReplaySchema.default("auto"),
    reasoningDetails: z.enum(["auto", "always", "never"]).default("auto"),
    thinking: z.enum(["auto", "enabled", "disabled"]).default("auto"),
    thinkingParam: ThinkingParamSchema.default("auto"),
    thinkingKeep: z.enum(["auto", "all", "none"]).default("auto"),
    clearThinking: z.enum(["auto", "keep", "clear"]).default("auto"),
    preserveThinking: z.enum(["auto", "on", "off"]).default("auto"),
    promptCaching: z.boolean().default(true),
    streamUsage: z.boolean().default(true),
    strictTools: z.boolean().default(false),
    parallelToolCalls: z.boolean().optional(),
    promptCacheKey: z.string().min(1).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
    auth: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        timeoutMs: z.number().int().positive().default(5000),
        refreshIntervalMs: z.number().int().positive().default(300000),
      })
      .optional(),
  })
  .superRefine((config, context) => {
    const ids = new Map<string, string>();
    const apiIds = new Map<string, string>();
    for (const [id, model] of Object.entries(config.models)) {
      const key = id.trim().toLowerCase();
      const previous = ids.get(key);
      if (previous !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["models", id],
          message: `duplicate model id "${id}" (also "${previous}")`,
        });
      } else {
        ids.set(key, id);
      }
      if (model.apiId) {
        const apiKey = model.apiId.trim().toLowerCase();
        const apiPrevious = apiIds.get(apiKey);
        if (apiPrevious !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["models", id, "apiId"],
            message: `duplicate apiId "${model.apiId}" (also used by "${apiPrevious}")`,
          });
        } else {
          apiIds.set(apiKey, id);
        }
      }
    }
  });

const McpEnvSchema = z
  .record(z.string().min(1).max(128), z.string().max(8192))
  .default({})
  .refine((env) => Object.keys(env).length <= 64, "at most 64 environment variables");

const McpHttpConfigForSettingsSchema = McpHttpServerConfigSchema.extend({
  env: McpEnvSchema,
});

export const McpServerConfigSchema = z.union([
  McpHttpConfigForSettingsSchema,
  McpStdioServerConfigSchema,
]);

export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerConfigSchema).default({}),
  })
  .default({ servers: {} })
  .superRefine((config, context) => {
    const names = Object.keys(config.servers);
    if (names.length > 32) {
      context.addIssue({ code: "custom", message: "at most 32 MCP servers" });
    }
    for (const name of names) {
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
        context.addIssue({
          code: "custom",
          path: ["servers", name],
          message: "server id must use lowercase letters, digits, _ or - and be at most 32 chars",
        });
      }
    }
  });

export const HarnessConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION).default(CONFIG_SCHEMA_VERSION).optional(),
    useDefaults: z.boolean().default(true),
    permissions: PermissionsConfigSchema.optional(),
    sandbox: SandboxConfigSchema.optional(),
    provider: z.string().min(1).default("openai"),
    model: z.string().min(1).default("gpt-5.1"),
    variant: z.string().min(1).optional(),
    reasoning: ReasoningEffortSchema.optional(),
    providers: z.record(z.string(), ProviderConfigSchema).default({}),
    voice: VoiceConfigSchema.optional(),
    vision: VisionConfigSchema.optional(),
    translation: TranslationConfigSchema.optional(),
    conversation: z
      .object({ enabled: z.boolean().default(true) })
      .default({ enabled: true })
      .optional(),
    skills: SkillsConfigSchema.optional(),
    failover: FailoverConfigSchema.optional(),
    transport: TransportConfigSchema.optional(),
    mcp: McpConfigSchema,
    hooks: HooksConfigSchema,
    terminal: TerminalConfigSchema,
    checkpoints: CheckpointsConfigSchema,
    sessions: SessionsConfigSchema,
    budgets: BudgetsConfigSchema,
    update: UpdateConfigSchema,
    telemetry: TelemetryConfigSchema,
    modules: ModulesConfigSchema.optional(),
    commands: CommandsConfigSchema,
    modes: ModesConfigSchema,
    subagents: SubagentsConfigSchema,
    lsp: LspConfigSchema,
    ui: z
      .object({
        sendShortcut: z.enum(["enter", "modifier-enter"]).default("enter"),
        followUpBehavior: z.enum(["queue", "steer"]).default("queue"),
      })
      .default({ sendShortcut: "enter", followUpBehavior: "queue" })
      .optional(),
    /** Zero uses the selected model's output limit. */
    maxOutputTokens: z.number().int().nonnegative().default(0),
    catalog: z
      .object({
        autoRefresh: z.boolean().default(true),
        ttlMs: z.number().int().positive().default(43_200_000),
      })
      .default({ autoRefresh: true, ttlMs: 43_200_000 }),
    context: z
      .object({
        window: z.number().int().positive().default(200_000),
        reserve: z.number().int().nonnegative().default(16_000),
        promptBudget: z.number().int().positive().default(24_000).optional(),
        compactWarn: z
          .tuple([
            z.number().min(0).max(100),
            z.number().min(0).max(100),
            z.number().min(0).max(100),
          ])
          .default([70, 85, 95])
          .optional(),
        outputBudgetRatio: z.number().positive().max(1).default(0.1).optional(),
      })
      .default({
        window: 200_000,
        reserve: 16_000,
        promptBudget: 24_000,
        compactWarn: [70, 85, 95],
        outputBudgetRatio: 0.1,
      }),
    loop: z
      .object({
        maxTurns: z.number().int().nonnegative().default(0),
        continuations: z.number().int().nonnegative().default(8),
        parallelTools: z.boolean().default(true),
      })
      .default({ maxTurns: 0, continuations: 8, parallelTools: true }),
    tools: z
      .object({
        maxOutputBytes: z.number().int().positive().default(50_000),
        maxOutputLines: z.number().int().positive().default(2000),
        bashTimeoutMs: z.number().int().positive().default(120_000),
        readLimitLines: z.number().int().positive().default(2000),
        retryAttempts: z.number().int().min(0).max(10).default(1).optional(),
        retryBackoffMs: z.number().int().nonnegative().max(60_000).default(500).optional(),
        outputBudgetRatio: z.number().positive().max(1).default(0.1).optional(),
      })
      .default({
        maxOutputBytes: 50_000,
        maxOutputLines: 2000,
        bashTimeoutMs: 120_000,
        readLimitLines: 2000,
        retryAttempts: 1,
        retryBackoffMs: 500,
        outputBudgetRatio: 0.1,
      }),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.vision?.model) {
      const model =
        config.providers[config.vision.provider || config.provider]?.models[config.vision.model];
      if (!model || model.disabled || !canDescribeImages(model))
        context.addIssue({
          code: "custom",
          path: ["vision", "model"],
          message: "Select a configured model with image input",
        });
    }
    const translation = config.translation;
    if (translation?.enabled && !config.conversation?.enabled) {
      const provider = config.providers[translation.provider];
      const model = provider?.models[translation.model];
      if (!provider || !model || model.tools === false)
        context.addIssue({
          code: "custom",
          path: ["translation", "model"],
          message: "Select a configured translation model with tool calling support",
        });
    }
    const failover = config.failover;
    if (failover?.enabled && failover.providers.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["failover", "providers"],
        message: "enabled failover requires at least one provider/model target",
      });
    }
  });

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>;
export type CheckpointsConfig = z.infer<typeof CheckpointsConfigSchema>;
export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;
export type BudgetsConfig = z.infer<typeof BudgetsConfigSchema>;
export type UpdateConfig = z.infer<typeof UpdateConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type CommandsConfig = z.infer<typeof CommandsConfigSchema>;
export type ModesConfig = z.infer<typeof ModesConfigSchema>;
export type SubagentsConfig = z.infer<typeof SubagentsConfigSchema>;
export type LspConfig = z.infer<typeof LspConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type HookCommand = z.infer<typeof HookCommandSchema>;
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>;
export type PermissionAction = z.infer<typeof PermissionActionSchema>;
export type PermissionRuleConfig = z.infer<typeof PermissionRuleConfigSchema>;
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderTransportConfig = z.infer<typeof ProviderTransportConfigSchema>;
export type TransportConfig = z.infer<typeof TransportConfigSchema>;
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
export type FailoverTargetConfig = z.infer<typeof FailoverTargetSchema>;
export type StructuredOutputFormat = z.infer<typeof StructuredOutputFormatSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;
export type ReasoningEffortName = z.infer<typeof ReasoningEffortSchema>;
export type ModelCost = z.infer<typeof ModelCostSchema>;
export type ModelVariant = z.infer<typeof ModelVariantSchema>;
export type ProviderAuth = z.infer<typeof ProviderConfigSchema>["auth"];
