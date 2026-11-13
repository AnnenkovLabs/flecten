import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";
import { defineTool } from "../types";
import { type Todo, type TodoArgs, todoPriorities, todoSpec, todoStatuses } from "./schema";

const todoSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1),
    status: z.enum(todoStatuses),
    priority: z.enum(todoPriorities).optional(),
  })
  .strict();

const todoFileSchema = z
  .object({
    version: z.literal(1),
    todos: z.array(todoSchema),
  })
  .strict();

const SESSION_FILE = /^[A-Za-z0-9_-]+$/;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function todoPath(cwd: string, sessionId: string): string {
  if (!SESSION_FILE.test(sessionId)) {
    throw new Error(`Invalid session id for todo storage: ${sessionId}`);
  }
  return join(cwd, ".liquid", "todos", `${sessionId}.json`);
}

async function loadTodos(path: string): Promise<Todo[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Todo file is not valid JSON: ${path}`);
  }
  const result = todoFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Todo file has an invalid shape: ${path}`);
  }
  return result.data.todos.map((todo) => ({
    id: todo.id,
    content: todo.content,
    status: todo.status,
    ...(todo.priority === undefined ? {} : { priority: todo.priority }),
  }));
}

async function saveTodos(path: string, todos: Todo[]): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify({ version: 1, todos }, null, 2)}\n`);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function result(op: TodoArgs["op"], todos: Todo[]): ToolResult {
  const lines =
    todos.length === 0
      ? ["No todos."]
      : todos.map((todo, index) => {
          const priority = todo.priority === undefined ? "" : ` (${todo.priority})`;
          return `${index + 1}. [${todo.status}]${priority} ${todo.id}: ${todo.content}`;
        });
  return {
    ok: true,
    output: [`# Todos (${todos.length})`, ...lines].join("\n"),
    data: { kind: "todo", op, todos },
  };
}

export async function runTodo(args: TodoArgs, context: ToolContext): Promise<ToolResult> {
  let path: string;
  let todos: Todo[];
  try {
    path = todoPath(context.cwd, context.sessionId);
    todos = await loadTodos(path);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  if (args.op === "list") return result(args.op, todos);

  try {
    if (args.op === "add") {
      if (args.content === undefined) throw new Error("add needs content");
      const content = args.content.trim();
      if (content.length === 0) throw new Error("add needs non-empty content");
      const todo: Todo = {
        id: `todo_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
        content,
        status: args.status ?? "pending",
        ...(args.priority === undefined ? {} : { priority: args.priority }),
      };
      todos.push(todo);
    } else if (args.op === "update") {
      if (args.id === undefined) throw new Error("update needs id");
      const index = todos.findIndex((todo) => todo.id === args.id);
      if (index < 0) throw new Error(`Todo not found: ${args.id}`);
      if (args.content === undefined && args.status === undefined && args.priority === undefined) {
        throw new Error("update needs content, status or priority");
      }
      const current = todos[index];
      if (current === undefined) throw new Error(`Todo not found: ${args.id}`);
      const next: Todo = { ...current };
      if (args.content !== undefined) {
        const content = args.content.trim();
        if (content.length === 0) throw new Error("update needs non-empty content");
        next.content = content;
      }
      if (args.status !== undefined) next.status = args.status;
      if (args.priority !== undefined) next.priority = args.priority;
      todos[index] = next;
    } else if (args.op === "remove") {
      if (args.id === undefined) throw new Error("remove needs id");
      const index = todos.findIndex((todo) => todo.id === args.id);
      if (index < 0) throw new Error(`Todo not found: ${args.id}`);
      todos.splice(index, 1);
    } else if (args.op === "clear") {
      todos = [];
    }

    await saveTodos(path, todos);
  } catch (error) {
    return { ok: false, output: "", error: message(error) };
  }

  return result(args.op, todos);
}

export const todoTool = defineTool({
  ...todoSpec,
  mutating: true,
  execute: runTodo,
});
