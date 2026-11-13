import { HooksConfigSchema } from "../../shared/hooks";
import {
  CONFIG_SCHEMA_VERSION,
  type HarnessConfig,
  type ProviderConfig,
  ProviderConfigSchema,
} from "./schema";
import { SKILL_SOURCES } from "./skills";

function provider(input: Parameters<typeof ProviderConfigSchema.parse>[0]): ProviderConfig {
  return ProviderConfigSchema.parse(input);
}

const providers: Record<string, ProviderConfig> = {
  openai: provider({
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  }),
  anthropic: provider({
    name: "Anthropic",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  }),
  google: provider({
    name: "Google",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GEMINI_API_KEY",
  }),
  openrouter: provider({
    name: "OpenRouter",
    protocol: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    reasoningReplay: "always",
    reasoningDetails: "always",
  }),
  deepseek: provider({
    name: "DeepSeek",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    reasoningReplay: "always",
    thinkingParam: "thinking",
  }),
  moonshotai: provider({
    name: "Moonshot AI",
    protocol: "openai-chat",
    baseUrl: "https://api.moonshot.ai/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    reasoningReplay: "always",
    thinkingParam: "thinking",
    thinkingKeep: "all",
  }),
  zai: provider({
    name: "Z.AI",
    protocol: "openai-chat",
    baseUrl: "https://api.z.ai/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    reasoningReplay: "always",
    thinkingParam: "thinking",
    clearThinking: "keep",
  }),
  alibaba: provider({
    name: "Alibaba",
    protocol: "openai-chat",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    thinkingParam: "enable_thinking",
    preserveThinking: "on",
  }),
  groq: provider({
    name: "Groq",
    protocol: "openai-chat",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    reasoningReplay: "alias",
  }),
  cerebras: provider({
    name: "Cerebras",
    protocol: "openai-chat",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    reasoningReplay: "alias",
  }),
  ollama: provider({
    name: "Ollama",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:11434/v1",
  }),
};

export function defaultConfig(): HarnessConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    useDefaults: true,
    provider: "openai",
    model: "gpt-5.1",
    conversation: { enabled: true },
    providers: structuredClone(providers),
    transport: {
      timeoutMs: 120_000,
      idleTimeoutMs: 60_000,
      retries: 2,
    },
    failover: {
      enabled: false,
      providers: [],
      retryBudget: 2,
      cooldownMs: 30_000,
      failureThreshold: 3,
    },
    mcp: { servers: {} },
    skills: { sources: [...SKILL_SOURCES] },
    terminal: {
      scrollback: 1000,
      commandTimeoutMs: 120_000,
      jobWaitMs: 30_000,
      ansi: true,
      notifyOnExit: true,
      maxProcesses: 64,
      maxMemoryMb: 4096,
    },
    checkpoints: { shell: true, maxFiles: 2000, maxMegabytes: 128, keep: 500, maxAgeDays: 14 },
    sessions: {
      retentionDays: 30,
      maxSessions: 100,
      trashDays: 7,
      maxConcurrent: 4,
      autoResume: true,
    },
    budgets: {},
    update: { channel: "stable", autoCheck: true, autoDownload: true, installOnQuit: true },
    telemetry: { enabled: false },
    commands: { dirs: [] },
    modes: { dirs: [] },
    subagents: { dirs: [] },
    lsp: { servers: {}, formatters: {} },
    hooks: HooksConfigSchema.parse({}),
    catalog: { autoRefresh: true, ttlMs: 43_200_000 },
    permissions: {
      read: "auto",
      write: "auto",
      shell: "auto",
      network: "ask",
      mcp: "ask",
      skill: "allow",
      externalPath: "deny",
      destructive: "ask",
      approvalTimeoutMs: 300_000,
      rules: [],
    },
    sandbox: {
      enabled: true,
      allowNetwork: false,
      readDenyPrefixes: [],
      writeDenyPrefixes: [],
      envAllowlist: ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "PWD"],
    },
    ui: { sendShortcut: "enter", followUpBehavior: "queue" },
    maxOutputTokens: 0,
    context: {
      window: 200_000,
      reserve: 16_000,
      promptBudget: 24_000,
      compactWarn: [70, 85, 95],
      outputBudgetRatio: 0.1,
    },
    loop: { maxTurns: 0, continuations: 8, parallelTools: true },
    tools: {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 120_000,
      readLimitLines: 2000,
      retryAttempts: 1,
      retryBackoffMs: 500,
      outputBudgetRatio: 0.1,
    },
  };
}

export function builtinProviders(): Array<{ id: string; provider: ProviderConfig }> {
  return Object.entries(structuredClone(providers)).map(([id, provider]) => ({ id, provider }));
}
