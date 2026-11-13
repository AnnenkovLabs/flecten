import { z } from "zod";

export const MAX_HOOKS_PER_EVENT = 64;

/** One catalog drives config validation, runtime capabilities and the settings editor. */
export const HOOK_EVENTS = {
  sessionStart: {
    label: "Session start",
    description: "Before each run in this session.",
    blocking: true,
    fields: [] as const,
  },
  userPromptSubmit: {
    label: "Send message",
    description: "Before a user message reaches the model.",
    blocking: true,
    fields: [] as const,
  },
  preToolUse: {
    label: "Before tool use",
    description: "Before a tool runs. A denial prevents execution.",
    blocking: true,
    fields: ["tool", "path", "command"] as const,
  },
  postToolUse: {
    label: "After tool use",
    description: "After a tool returns, including failed calls.",
    blocking: false,
    fields: ["tool", "path", "command"] as const,
  },
  stop: {
    label: "Stop",
    description: "After a run completes, except cancellation or error.",
    blocking: false,
    fields: [] as const,
  },
  sessionEnd: {
    label: "Session end",
    description: "After each run, including cancellation or error.",
    blocking: false,
    fields: [] as const,
  },
  permission: {
    label: "Permission check",
    description:
      "Before enforcing a tool permission decision. A hook can deny but cannot grant access.",
    blocking: true,
    fields: ["tool", "path", "command"] as const,
  },
  compact: {
    label: "Context compaction",
    description: "After a summary is generated, before it replaces context.",
    blocking: true,
    fields: [] as const,
  },
  notification: {
    label: "Notification",
    description: "When the session emits a notification.",
    blocking: false,
    fields: [] as const,
  },
  subagent: {
    label: "Subagent",
    description: "When a subagent starts or finishes. Only the start can be blocked.",
    blocking: true,
    fields: ["tool"] as const,
  },
  toolBatch: {
    label: "Tool batch",
    description: "Before a group of tools runs. Conditions match one tool in the group.",
    blocking: true,
    fields: ["tool", "path", "command"] as const,
  },
} as const;

export type HookName = keyof typeof HOOK_EVENTS;
export const HOOK_NAMES = Object.keys(HOOK_EVENTS) as [HookName, ...HookName[]];
export type HookMatcherField = "tool" | "path" | "pathPrefix" | "command" | "commandPrefix";

export function hookCanBlock(event: HookName): boolean {
  return HOOK_EVENTS[event].blocking;
}

export const HookMatcherSchema = z.union([
  z.string().trim().max(128),
  z
    .object({
      tool: z.string().trim().min(1).max(128).optional(),
      path: z.string().min(1).max(4096).optional(),
      pathPrefix: z.string().min(1).max(4096).optional(),
      command: z.string().min(1).max(8192).optional(),
      commandPrefix: z.string().trim().min(1).max(8192).optional(),
    })
    .strict(),
]);

export const HookDefinitionSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    name: z.string().trim().max(120).optional(),
    responseFormat: z.enum(["json", "text"]).optional(),
    type: z.enum(["command", "http"]).default("command"),
    command: z.string().trim().max(8192).default(""),
    url: z.url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    envAllowlist: z.array(z.string().min(1)).max(64).optional(),
    matcher: HookMatcherSchema.default("*"),
    timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
    enabled: z.boolean().default(true),
    async: z.boolean().default(false),
    failClosed: z.boolean().default(false),
  })
  .superRefine((hook, context) => {
    if (hook.type === "http") {
      let valid = false;
      try {
        valid = !!hook.url && ["http:", "https:"].includes(new URL(hook.url).protocol);
      } catch {}
      if (!valid) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "HTTP hook needs an http or https URL",
        });
      }
    } else if (!hook.command) {
      context.addIssue({ code: "custom", path: ["command"], message: "Hook command is required" });
    }
  });

export const HooksConfigSchema = z
  .object(
    Object.fromEntries(
      HOOK_NAMES.map((name) => [
        name,
        z.array(HookDefinitionSchema).max(MAX_HOOKS_PER_EVENT).default([]),
      ]),
    ) as Record<HookName, z.ZodDefault<z.ZodArray<typeof HookDefinitionSchema>>>,
  )
  .strict()
  .prefault({});

export type HookConfiguration = z.infer<typeof HookDefinitionSchema>;

export const HookSampleSchema = z
  .object({
    toolName: z.string().min(1).max(128).optional(),
    path: z.string().max(4096).optional(),
    command: z.string().max(8192).optional(),
    prompt: z.string().max(16_000).optional(),
    toolOk: z.boolean().optional(),
    permissionAction: z
      .enum(["read", "write", "shell", "network", "mcp", "skill", "external_path"])
      .optional(),
  })
  .strict();
export type HookSample = z.infer<typeof HookSampleSchema>;

export const HookSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project") }),
  z.object({ type: z.literal("module"), name: z.string(), revision: z.string() }),
]);
export type HookSource = z.infer<typeof HookSourceSchema>;

export const HookRunSchema = z.object({
  event: z.enum(HOOK_NAMES),
  index: z.number().int().nonnegative(),
  id: z.string().optional(),
  name: z.string().optional(),
  source: HookSourceSchema.optional(),
  ok: z.boolean(),
  blocked: z.boolean().optional(),
  decision: z.enum(["allow", "deny"]).optional(),
  durationMs: z.number().nonnegative(),
  output: z.string().optional(),
  error: z.string().optional(),
  async: z.boolean().optional(),
  exitCode: z.number().int().optional(),
  timedOut: z.boolean().optional(),
  aborted: z.boolean().optional(),
  outputTruncated: z.boolean().optional(),
});
export type HookRun = z.infer<typeof HookRunSchema>;

export const HookTestResultSchema = z.object({
  matched: z.boolean(),
  blocked: z.boolean(),
  reason: z.string().optional(),
  context: z.array(z.string()),
  runs: z.array(HookRunSchema),
});
export type HookTestResult = z.infer<typeof HookTestResultSchema>;
