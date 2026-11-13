import { z } from "zod";

export const todoStatuses = ["pending", "in_progress", "completed", "cancelled"] as const;
export const todoPriorities = ["low", "medium", "high"] as const;

export const todoSpec = {
  name: "todo",
  description:
    "Keep a short plan for complex work. list reads the plan; add requires content; update requires id and at least one of content, status or priority; remove requires id; clear removes all items. Persisted per session across context compaction. Mark completed or cancelled work promptly and skip a todo list for a simple one-step request. Every operation returns the full list.",
  schema: z
    .object({
      op: z.enum(["list", "add", "update", "remove", "clear"]).describe("Operation to perform"),
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
