import { type Dirent, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { PermissionRule } from "../../security/types";
import type { SubagentSpec } from "./types";

export const MAX_SUBAGENT_DEFINITION_BYTES = 256 * 1024;

const FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(md|json)$/;

const nameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "name must be kebab-case");

const permissionSchema = z
  .object({
    action: z.enum(["read", "write", "shell", "network", "mcp", "skill", "external_path"]),
    tool: z.string().trim().min(1).optional(),
    pathPrefix: z.string().trim().min(1).optional(),
    policy: z.enum(["deny", "auto", "ask", "allow"]),
    note: z.string().trim().min(1).optional(),
  })
  .strict();

const budgetSchema = z
  .object({
    maxTurns: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxCost: z.number().positive().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    allowedTools: z.array(z.string().trim().min(1)).min(1),
    permissions: z.array(permissionSchema),
    budget: budgetSchema,
  })
  .strict();

const markdownSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    "allowed-tools": z.array(z.string().trim().min(1)).min(1),
    permissions: z.array(permissionSchema),
    budget: budgetSchema,
  })
  .strict();

const jsonSchema = bodySchema.extend({ systemPrompt: z.string().trim().min(1) }).strict();

export const genericSubagentResultSchema = z.object({ summary: z.string().min(1) }).passthrough();

const RESULT_INSTRUCTION =
  'Return only JSON with a non-empty "summary" string; add any role-specific fields you need.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issuesOf(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function parseJson(text: string, path: string): SubagentSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`subagent definition ${path}: invalid JSON: ${messageOf(error)}`);
  }
  const parsed = jsonSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`subagent definition ${path}: ${issuesOf(parsed.error)}`);
  }
  return toSpec(parsed.data.name, parsed.data, parsed.data.systemPrompt, path);
}

function parseMarkdown(text: string, path: string): SubagentSpec {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (match === null) {
    throw new Error(
      `subagent definition ${path}: Markdown needs YAML frontmatter between --- lines`,
    );
  }
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(match[1] ?? "");
  } catch (error) {
    throw new Error(`subagent definition ${path}: invalid YAML: ${messageOf(error)}`);
  }
  const parsed = markdownSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`subagent definition ${path}: ${issuesOf(parsed.error)}`);
  }
  const systemPrompt = (match[2] ?? "").trim();
  if (systemPrompt.length === 0) {
    throw new Error(`subagent definition ${path}: system prompt body is required`);
  }
  return toSpec(
    parsed.data.name,
    {
      ...parsed.data,
      allowedTools: parsed.data["allowed-tools"],
    },
    systemPrompt,
    path,
  );
}

function permissionOf(rule: z.infer<typeof permissionSchema>): PermissionRule {
  return {
    action: rule.action,
    policy: rule.policy,
    ...(rule.tool === undefined ? {} : { tool: rule.tool }),
    ...(rule.pathPrefix === undefined ? {} : { pathPrefix: rule.pathPrefix }),
    ...(rule.note === undefined ? {} : { note: rule.note }),
  };
}

function budgetOf(budget: z.infer<typeof budgetSchema>): SubagentSpec["budget"] {
  return {
    maxTurns: budget.maxTurns,
    maxTokens: budget.maxTokens,
    ...(budget.maxCost === undefined ? {} : { maxCost: budget.maxCost }),
  };
}

function toSpec(
  name: string,
  data: Omit<z.infer<typeof bodySchema>, "name">,
  systemPrompt: string,
  path: string,
): SubagentSpec {
  return {
    id: name,
    name,
    description: data.description,
    systemPrompt: `${systemPrompt}\n\n${RESULT_INSTRUCTION}`,
    allowedTools: data.allowedTools,
    ...(data.model === undefined ? {} : { model: data.model }),
    ...(data.provider === undefined ? {} : { provider: data.provider }),
    permissions: data.permissions.map(permissionOf),
    budget: budgetOf(data.budget),
    resultSchema: genericSubagentResultSchema,
    source: "definition",
    sourcePath: path,
  };
}

function filesIn(directory: string): string[] {
  const root = resolve(directory);
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const realRoot = realpathSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const match = FILE_PATTERN.exec(entry.name);
    if (match === null) continue;
    const path = join(root, entry.name);
    if (!entry.isFile()) {
      throw new Error(`subagent definition ${path}: must be a regular file`);
    }
    const real = realpathSync(path);
    if (!real.startsWith(`${realRoot}${sep}`)) {
      throw new Error(`subagent definition ${path}: resolves outside ${directory}`);
    }
    if (statSync(path).size > MAX_SUBAGENT_DEFINITION_BYTES) {
      throw new Error(
        `subagent definition ${path}: exceeds ${MAX_SUBAGENT_DEFINITION_BYTES} bytes`,
      );
    }
    files.push(path);
  }
  return files.sort();
}

export function loadSubagentDefinitions(directories: readonly string[]): SubagentSpec[] {
  const specs: SubagentSpec[] = [];
  const seen = new Map<string, string>();
  for (const directory of directories) {
    for (const path of filesIn(directory)) {
      const stem = FILE_PATTERN.exec(basename(path))?.[1] ?? "";
      const text = readFileSync(path, "utf8");
      const spec = path.endsWith(".json") ? parseJson(text, path) : parseMarkdown(text, path);
      if (spec.id !== stem) {
        throw new Error(
          `subagent definition ${path}: name "${spec.id}" must match file name "${stem}"`,
        );
      }
      const previous = seen.get(spec.id);
      if (previous !== undefined) {
        throw new Error(`duplicate subagent definition: ${spec.id} (${previous}, ${path})`);
      }
      seen.set(spec.id, path);
      specs.push(spec);
    }
  }
  return specs;
}
