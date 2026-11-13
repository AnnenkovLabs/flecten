import { dirname, join } from "node:path";
import bundledBase from "../../prompts/base.md" with { type: "text" };
import contextPagesPrompt from "../../prompts/context-pages.md" with { type: "text" };
import memoryPrompt from "../../prompts/memory.md" with { type: "text" };
import responseSummary from "../../prompts/response-summary.md" with { type: "text" };
import talkerBase from "../../prompts/talker.md" with { type: "text" };
import workerBase from "../../prompts/worker.md" with { type: "text" };
import workerResponse from "../../prompts/worker-response.md" with { type: "text" };
import { productEnv } from "../../shared/environment.cjs";
import { prefixHash } from "../context/compactor";
import {
  type InstructionBundle,
  type InstructionLocations,
  loadInstructions,
} from "../context/instructions";
import {
  DEFAULT_PROMPT_BUDGET_TOKENS,
  type PromptBudgetPart,
  type PromptBudgetResult,
  type PromptTextPart,
  promptBudget,
} from "../context/prompt-budget";
import { HarnessError } from "../errors";

export interface PromptSection {
  readonly id?: string;
  readonly text: string;
  readonly required?: boolean;
}

export type PromptSectionInput = string | PromptSection;

export interface BuildPromptOptions {
  readonly role?: "talker" | "worker";
  readonly sections?: readonly PromptSectionInput[];
  readonly tools?: readonly {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }[];
  /** Child roles return their declared schema without the user-facing HTML kit. */
  readonly responseFormat?: "summary" | "structured";
  readonly maxPromptTokens?: number;
  readonly instructions?: InstructionLocations;
}

export interface BuiltPrompt {
  readonly system: string;
  readonly systemParts: readonly PromptTextPart[];
  /** Version of the whole system text; whitespace-only edits keep it. */
  readonly version: string;
  /** Version of the harness prompt alone: a hash of prompts/base.md, the same for every project. */
  readonly base: string;
  /** Hash of everything the model gets before the first message: system text and tool schemas. */
  readonly hash: string;
  readonly instructions: InstructionBundle;
  readonly budget: PromptBudgetResult;
}

/** What a session stores about its system prompt, so a run can be traced to the exact prompt. */
export interface PromptStamp {
  version: string;
  base: string;
  hash: string;
  tokens: number;
  maxTokens: number;
  overBudget: boolean;
  parts: Array<{ id: string; tokens: number; trimmed: boolean; omitted: boolean }>;
  instructions?: {
    sources: Array<{ kind: InstructionBundle["sources"][number]["kind"]; path: string }>;
    conflicts: InstructionBundle["conflicts"];
  };
}

export function promptStamp(prompt: BuiltPrompt, maxTokens: number): PromptStamp {
  return {
    version: prompt.version,
    base: prompt.base,
    hash: prompt.hash,
    tokens: prompt.budget.tokens,
    maxTokens,
    overBudget: prompt.budget.overBudget,
    parts: prompt.budget.parts.map((part) => ({
      id: part.id,
      tokens: part.tokens,
      trimmed: part.trimmed,
      omitted: part.omitted,
    })),
    instructions: {
      sources: prompt.instructions.sources.map(({ kind, path }) => ({ kind, path })),
      conflicts: prompt.instructions.conflicts,
    },
  };
}

function promptCandidates(): string[] {
  const candidates: string[] = [];
  const env = productEnv("PROMPTS_DIR")?.trim();
  if (env) candidates.push(join(env, "base.md"));
  candidates.push(join(dirname(process.execPath), "prompts", "base.md"));
  candidates.push(join(import.meta.dir, "../../prompts/base.md"));
  candidates.push(join(process.cwd(), "prompts", "base.md"));
  return candidates;
}

async function readBasePrompt(): Promise<string> {
  for (const path of promptCandidates()) {
    const file = Bun.file(path);
    if (await file.exists()) return file.text();
  }
  throw new HarnessError(
    "invalid_input",
    `prompts/base.md not found; looked in ${promptCandidates().join(", ")}`,
  );
}

function environment(cwd: string): string {
  return [
    "# Environment",
    "",
    `Working directory: ${cwd}`,
    `Platform: ${process.platform}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");
}

export function configuredBudget(): number {
  const raw = productEnv("PROMPT_BUDGET_TOKENS");
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_PROMPT_BUDGET_TOKENS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PROMPT_BUDGET_TOKENS;
}

/** Text with every run of whitespace turned into one space, trimmed at both ends. */
function collapsedWhitespace(text: string): string {
  let out = "";
  let gap = false;
  for (const char of text) {
    if (char.trim().length === 0) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += " ";
    gap = false;
    out += char;
  }
  return out;
}

export function promptVersion(system: string): string {
  return `v1-${prefixHash(collapsedWhitespace(system), "").slice(0, 16)}`;
}

function baseVersion(base: string): string {
  return `base-${prefixHash(collapsedWhitespace(base), "").slice(0, 12)}`;
}

function sectionPart(section: PromptSectionInput, index: number): PromptBudgetPart {
  if (typeof section === "string") {
    return { id: `section-${index + 1}`, text: section };
  }
  return {
    id: section.id ?? `section-${index + 1}`,
    text: section.text,
    ...(section.required === undefined ? {} : { required: section.required }),
  };
}

export async function buildPrompt(
  cwd: string,
  options: BuildPromptOptions = {},
): Promise<BuiltPrompt> {
  const [base, instructions] = await Promise.all([
    options.role === "talker"
      ? Promise.resolve(talkerBase)
      : options.role === "worker"
        ? Promise.resolve(workerBase)
        : readBasePrompt(),
    loadInstructions(cwd, options.instructions),
  ]);
  const parts: PromptBudgetPart[] = [
    {
      id: "base",
      text: base.trim(),
      required: true,
      ...(options.role || base === bundledBase ? { workingLanguage: "en" as const } : {}),
    },
    ...(options.responseFormat === "structured"
      ? []
      : [
          {
            id: "response-format",
            text: (options.role === "worker" ? workerResponse : responseSummary).trim(),
            required: true,
            workingLanguage: "en" as const,
          },
        ]),
    { id: "environment", text: environment(cwd), required: true, workingLanguage: "en" },
  ];
  if (options.tools?.some((tool) => tool.name === "memory")) {
    parts.push({ id: "memory", text: memoryPrompt.trim(), required: true, workingLanguage: "en" });
  }
  if (options.tools?.some((tool) => tool.name === "context")) {
    parts.push({
      id: "context-pages",
      text: contextPagesPrompt.trim(),
      required: true,
      workingLanguage: "en",
    });
  }
  if (instructions.text.length > 0) {
    parts.push({
      id: "instructions",
      text: `# Instructions\n\n${instructions.text}`,
      required: true,
    });
  }
  (options.sections ?? []).forEach((section, index) => {
    const part = sectionPart(section, index);
    if (part.text.trim().length > 0) parts.push(part);
  });
  if (options.tools !== undefined && options.tools.length > 0) {
    parts.push({
      id: "tool-schemas",
      text: JSON.stringify(options.tools),
      required: true,
      external: true,
    });
  }

  const budget = promptBudget({
    parts,
    maxTokens: options.maxPromptTokens ?? configuredBudget(),
  });
  const schemas = options.tools === undefined ? "" : JSON.stringify(options.tools);
  return {
    system: budget.text,
    systemParts: budget.blocks,
    version: promptVersion(budget.text),
    base: baseVersion(base),
    hash: prefixHash(budget.text, schemas),
    instructions,
    budget,
  };
}

export async function buildSystemPrompt(
  cwd: string,
  sections: readonly PromptSectionInput[] = [],
  options: Omit<BuildPromptOptions, "sections"> = {},
): Promise<string> {
  return (await buildPrompt(cwd, { ...options, sections })).system;
}
