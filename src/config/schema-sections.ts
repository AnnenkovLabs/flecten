import { z } from "zod";
import {
  HookDefinitionSchema,
  HooksConfigSchema as SharedHooksConfigSchema,
} from "../../shared/hooks";
import { isGithubName, UPDATE_CHANNELS } from "../../shared/update-settings.cjs";

/** Config sections outside providers and models: tools, safety, terminal, sessions, limits. */

export const HookCommandSchema = HookDefinitionSchema;
export const HooksConfigSchema = SharedHooksConfigSchema;

export const PermissionPolicySchema = z.enum(["deny", "auto", "ask", "allow"]);
export const PermissionActionSchema = z.enum([
  "read",
  "write",
  "shell",
  "network",
  "mcp",
  "skill",
  "external_path",
]);

export const PermissionRuleConfigSchema = z.object({
  action: PermissionActionSchema,
  tool: z.string().min(1).optional(),
  pathPrefix: z.string().min(1).optional(),
  /** Destructive operation id from the shell policy, as `git-push-force`. */
  risk: z.string().min(1).max(64).optional(),
  requestKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  target: z.string().max(10000).optional(),
  cwd: z.string().min(1).optional(),
  policy: PermissionPolicySchema,
  checkpoint: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

export const PermissionsConfigSchema = z
  .object({
    read: PermissionPolicySchema.default("auto"),
    write: PermissionPolicySchema.default("auto"),
    shell: PermissionPolicySchema.default("auto"),
    network: PermissionPolicySchema.default("ask"),
    mcp: PermissionPolicySchema.default("ask"),
    skill: PermissionPolicySchema.default("allow"),
    externalPath: PermissionPolicySchema.default("deny"),
    /** Destructive shell operations no checkpoint can undo: push --force, rm outside, disks. */
    destructive: PermissionPolicySchema.default("ask"),
    /** How long a tool call waits for an answer before it is denied and the run goes on. */
    approvalTimeoutMs: z.number().int().min(10_000).max(86_400_000).default(300_000),
    rules: z.array(PermissionRuleConfigSchema).default([]),
  })
  .default({
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
  });

export const SandboxConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    allowNetwork: z.boolean().default(false),
    readDenyPrefixes: z.array(z.string()).default([]),
    writeDenyPrefixes: z.array(z.string()).default([]),
    envAllowlist: z
      .array(z.string())
      .default(["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "PWD"]),
  })
  .default({
    enabled: true,
    allowNetwork: false,
    readDenyPrefixes: [],
    writeDenyPrefixes: [],
    envAllowlist: ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "PWD"],
  });

export const FailoverTargetSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

export const FailoverConfigSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(FailoverTargetSchema).max(16).default([]),
  retryBudget: z.number().int().min(0).max(10).optional(),
  cooldownMs: z.number().int().positive().max(3_600_000).optional(),
  failureThreshold: z.number().int().positive().max(20).optional(),
});

export const TerminalConfigSchema = z
  .object({
    shell: z.string().min(1).optional(),
    scrollback: z.number().int().positive().max(100_000).default(1000),
    /** Default wait of `terminal run` for the command to finish. */
    commandTimeoutMs: z.number().int().positive().max(600_000).default(120_000),
    /** Default wait of `jobs wait`. */
    jobWaitMs: z.number().int().positive().max(1_800_000).default(30_000),
    /** Background jobs are stopped after this time; unset means no limit. */
    jobTimeoutMs: z.number().int().positive().optional(),
    ansi: z.boolean().default(true),
    notifyOnExit: z.boolean().default(true),
    /** Environment passed to terminals and jobs; the sandbox allowlist when unset. */
    envAllowlist: z.array(z.string().min(1).max(128)).max(64).optional(),
    maxProcesses: z.number().int().positive().max(4096).default(64),
    maxMemoryMb: z.number().int().positive().max(1_048_576).default(4096),
    ports: z
      .object({
        min: z.number().int().min(1).max(65535),
        max: z.number().int().min(1).max(65535),
      })
      .refine((range) => range.min <= range.max, "Minimum port must not exceed maximum port")
      .nullable()
      .optional(),
  })
  .default({
    scrollback: 1000,
    commandTimeoutMs: 120_000,
    jobWaitMs: 30_000,
    ansi: true,
    notifyOnExit: true,
    maxProcesses: 64,
    maxMemoryMb: 4096,
  })
  .optional();

/** Undo for shell commands and how long checkpoints are kept. */
export const CheckpointsConfigSchema = z
  .object({
    shell: z.boolean().default(true),
    maxFiles: z.number().int().positive().max(20_000).default(2000),
    maxMegabytes: z.number().int().positive().max(4096).default(128),
    keep: z.number().int().positive().max(10_000).default(500),
    maxAgeDays: z.number().int().positive().max(365).default(14),
  })
  .default({ shell: true, maxFiles: 2000, maxMegabytes: 128, keep: 500, maxAgeDays: 14 })
  .optional();

export const SessionsConfigSchema = z
  .object({
    retentionDays: z.number().int().positive().default(30),
    maxSessions: z.number().int().positive().default(100),
    trashDays: z.number().int().nonnegative().default(7),
    /** Tasks that may run at the same time; each has its own queue, approvals and terminals. */
    maxConcurrent: z.number().int().positive().max(16).default(4),
    /** Resume a run the sidecar crash interrupted, once, from where it stopped. */
    autoResume: z.boolean().default(true),
  })
  .default({
    retentionDays: 30,
    maxSessions: 100,
    trashDays: 7,
    maxConcurrent: 4,
    autoResume: true,
  })
  .optional();

export const BudgetsConfigSchema = z
  .object({
    maxTokens: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
    maxWallClockMs: z.number().int().positive().optional(),
  })
  .default({})
  .optional();

export const UpdateConfigSchema = z
  .object({
    channel: z.enum(UPDATE_CHANNELS).default("stable"),
    feedUrl: z.string().min(1).optional(),
    github: z
      .object({
        owner: z.string().refine(isGithubName),
        repo: z.string().refine(isGithubName),
      })
      .optional(),
    autoCheck: z.boolean().default(true),
    autoDownload: z.boolean().default(true),
    installOnQuit: z.boolean().default(true),
  })
  .default({ channel: "stable", autoCheck: true, autoDownload: true, installOnQuit: true })
  .optional();

export const TelemetryConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().min(1).optional(),
  })
  .default({ enabled: false })
  .optional();

export const CommandsConfigSchema = z
  .object({
    dirs: z.array(z.string().min(1)).default([]),
  })
  .default({ dirs: [] })
  .optional();

export const ModesConfigSchema = z
  .object({
    dirs: z.array(z.string().min(1)).default([]),
  })
  .default({ dirs: [] })
  .optional();

export const SubagentsConfigSchema = z
  .object({
    dirs: z.array(z.string().min(1)).default([]),
  })
  .default({ dirs: [] })
  .optional();

// ponytail: defaulted fields stay optional in the inferred type so existing HarnessConfig
// literals compile; make them required once every consumer reads config through loadConfig.
