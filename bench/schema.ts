import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const TASK_GROUPS = [
  "read",
  "edit",
  "grep",
  "glob",
  "bash",
  "apply_patch",
  "checkpoints",
  "compaction",
] as const;

const callSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});

const turnSchema = z
  .object({
    text: z.string().optional(),
    calls: z.array(callSchema).default([]),
    stop: z.enum(["end", "tool_use", "max_tokens"]).optional(),
  })
  .superRefine((turn, context) => {
    if (turn.calls.length > 0 && turn.stop !== undefined && turn.stop !== "tool_use") {
      context.addIssue({
        code: "custom",
        message: "a turn with tool calls can only stop with tool_use",
      });
    }
    if (turn.calls.length === 0 && turn.stop === "tool_use") {
      context.addIssue({ code: "custom", message: "tool_use needs at least one tool call" });
    }
  });

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const checkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("result"),
    stopReason: z.enum(["done", "end", "stopped", "error", "max_turns"]).optional(),
    pass: z.boolean().optional(),
  }),
  z.object({ type: z.literal("tool_ok"), tool: z.string().min(1) }),
  z.object({
    type: z.literal("tool_error"),
    tool: z.string().min(1),
    contains: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("tool_output_contains"),
    tool: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("tool_output_not_contains"),
    tool: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("tool_data"),
    tool: z.string().min(1),
    path: z.string().min(1),
    equals: valueSchema,
  }),
  z.object({
    type: z.literal("file_equals"),
    path: z.string().min(1),
    content: z.string(),
  }),
  z.object({ type: z.literal("file_contains"), path: z.string().min(1), text: z.string().min(1) }),
  z.object({ type: z.literal("file_absent"), path: z.string().min(1) }),
  z.object({ type: z.literal("checkpoint_count"), count: z.number().int().nonnegative() }),
  z.object({ type: z.literal("checkpoint_tool"), tool: z.string().min(1) }),
  z.object({ type: z.literal("checkpoint_finalized") }),
  z.object({ type: z.literal("checkpoint_paths"), paths: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("checkpoint_restore"), target: z.enum(["before", "after"]) }),
  z.object({ type: z.literal("compaction_count"), min: z.number().int().nonnegative() }),
  z.object({ type: z.literal("compaction_summary_contains"), text: z.string().min(1) }),
  z
    .object({
      type: z.literal("request_count"),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .refine((check) => check.min !== undefined || check.max !== undefined, {
      message: "request_count needs min or max",
    }),
  z.object({ type: z.literal("request_contains"), text: z.string().min(1) }),
]);

const taskOptionsSchema = z.object({
  tools: z.array(z.string().min(1)).min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  reserveTokens: z.number().int().nonnegative().optional(),
  maxTurns: z.number().int().positive().optional(),
  continuations: z.number().int().nonnegative().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  parallelTools: z.boolean().optional(),
});

function safeRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export const taskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  group: z.enum(TASK_GROUPS),
  prompt: z.string().min(1),
  files: z
    .record(z.string().min(1), z.string())
    .refine((files) => Object.keys(files).every(safeRelativePath), {
      message: "fixture paths must stay inside the task directory",
    }),
  script: z.array(turnSchema).min(1),
  checks: z.array(checkSchema).min(1),
  budgetTokens: z.number().int().positive(),
  baseline: z.literal("codex").default("codex"),
  options: taskOptionsSchema.default({}),
});

export type BenchTask = z.infer<typeof taskSchema>;
export type BenchTurn = z.infer<typeof turnSchema>;
export type BenchCheck = z.infer<typeof checkSchema>;

export const defaultTasksDir = join(import.meta.dir, "tasks");

export async function loadTasks(tasksDir = defaultTasksDir): Promise<BenchTask[]> {
  const entries = await readdir(tasksDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const tasks: BenchTask[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = join(tasksDir, file);
    const raw = await Bun.file(path).text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : error}`);
    }
    const result = taskSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`${file}: ${result.error.message}`);
    }
    if (seen.has(result.data.id)) throw new Error(`${file}: duplicate task id ${result.data.id}`);
    seen.add(result.data.id);
    tasks.push(result.data);
  }
  return tasks;
}
