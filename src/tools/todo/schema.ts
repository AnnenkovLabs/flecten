import { z } from "zod";

export const todoStatuses = ["pending", "in_progress", "completed", "cancelled"] as const;
export const todoPriorities = ["low", "medium", "high"] as const;

const todoBatchItem = z
  .object({
    id: z.string().min(1).optional(),
    content: z.string().min(1),
    status: z.enum(todoStatuses).optional(),
    priority: z.enum(todoPriorities).optional(),
  })
  .strict();

export const todoSpec = {
  name: "todo",
  description:
    "Optional plan tracker for complex multi-stage work (skip for direct tasks). Prefer set with items to write or update the whole list in one call; list reads; add/update/remove/clear modify entries.",
  schema: z
    .object({
      op: z
        .enum(["list", "set", "add", "update", "remove", "clear"])
        .describe("Operation to perform"),
      items: z.array(todoBatchItem).max(50).optional().describe("Full todo list for op=set"),
      content: z.string().min(1).optional().describe("Todo text for add or update"),
      id: z.string().min(1).optional().describe("Todo id for update or remove"),
      status: z.enum(todoStatuses).optional().describe("New status for add or update"),
      priority: z.enum(todoPriorities).optional().describe("Priority for add or update"),
    })
    .strict(),
};

export type TodoArgs = z.infer<typeof todoSpec.schema>;
export type TodoStatus = (typeof todoStatuses)[number];
export type TodoPriority = (typeof todoPriorities)[number];

export type Todo = {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
};
