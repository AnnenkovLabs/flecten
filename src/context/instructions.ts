import { homedir } from "node:os";
import { dirname, join } from "node:path";
import instructionDiscovery from "../../prompts/project-instruction-discovery.md" with {
  type: "text",
};
import instructionLimit from "../../prompts/project-instruction-limit.md" with { type: "text" };
import { HarnessError } from "../errors";
import { canonicalPath } from "../util/canonical-path";
import { oneLine } from "../util/text";
import { discoverNestedInstructions } from "./instruction-discovery";

export type InstructionKind = "managed" | "user" | "project" | "local" | "nested";

export interface InstructionSource {
  readonly kind: InstructionKind;
  readonly path: string;
  readonly text: string;
}

export interface InstructionConflict {
  readonly heading: string;
  readonly paths: readonly [string, string];
}

export interface InstructionBundle {
  readonly sources: readonly InstructionSource[];
  readonly text: string;
  readonly conflicts: readonly InstructionConflict[];
}

export interface InstructionLocations {
  readonly managed?: readonly string[];
  readonly user?: readonly string[];
  readonly project?: readonly string[];
  readonly local?: readonly string[];
  readonly nested?: boolean;
  readonly nestedMaxDepth?: number;
  readonly nestedMaxFiles?: number;
}

const DEFAULT_NESTED_DEPTH = 3;
const DEFAULT_NESTED_FILES = 32;
const MAX_INSTRUCTION_BYTES = 65_536;

interface DefaultInstructionLocations {
  readonly managed: readonly string[];
  readonly user: readonly string[];
  readonly project: readonly string[];
  readonly local: readonly string[];
  readonly nested: boolean;
  readonly nestedMaxDepth: number;
  readonly nestedMaxFiles: number;
}

export function defaultInstructionLocations(cwd: string): DefaultInstructionLocations {
  const home = homedir();
  const managed =
    process.platform === "win32"
      ? [
          join(process.env.ProgramData ?? "C:\\ProgramData", "Liquid", "AGENTS.md"),
          join(process.env.ProgramData ?? "C:\\ProgramData", "Flecten", "AGENTS.md"),
        ]
      : process.platform === "darwin"
        ? [
            "/Library/Application Support/Liquid/AGENTS.md",
            "/etc/liquid/AGENTS.md",
            "/Library/Application Support/Flecten/AGENTS.md",
            "/etc/flecten/AGENTS.md",
          ]
        : ["/etc/liquid/AGENTS.md", "/etc/flecten/AGENTS.md"];
  return {
    managed,
    user: [
      join(home, ".config", "liquid", "AGENTS.md"),
      join(home, ".liquid", "AGENTS.md"),
      join(home, ".config", "flecten", "AGENTS.md"),
      join(home, ".flecten", "AGENTS.md"),
    ],
    project: [join(cwd, "AGENTS.md"), join(cwd, "CLAUDE.md")],
    local: [join(cwd, "AGENTS.local.md")],
    nested: false,
    nestedMaxDepth: DEFAULT_NESTED_DEPTH,
    nestedMaxFiles: DEFAULT_NESTED_FILES,
  };
}

async function readTextFile(path: string, available: number): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.slice(0, available + 1).arrayBuffer();
  } catch {
    return undefined;
  }
  if (bytes.byteLength > available) {
    throw new HarnessError(
      "invalid_input",
      `Instruction sources exceed the ${MAX_INSTRUCTION_BYTES}-byte startup budget at ${path}. Reduce the instruction files or select a narrower project folder.`,
    );
  }
  const text = new TextDecoder().decode(bytes).trim();
  return text.length > 0 ? text : undefined;
}

async function readSources(
  kind: InstructionKind,
  paths: readonly string[],
  seen: Set<string>,
  budget: { remaining: number; limited: boolean },
): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = [];
  for (const candidate of paths) {
    const path = canonicalPath(candidate);
    if (seen.has(path)) continue;
    let text: string | undefined;
    try {
      text = await readTextFile(path, budget.remaining);
    } catch (error) {
      if (kind !== "nested" || !(error instanceof HarnessError)) throw error;
      budget.limited = true;
      continue;
    }
    if (text === undefined) continue;
    budget.remaining -= Buffer.byteLength(text);
    seen.add(path);
    sources.push({ kind, path, text });
  }
  return sources;
}

function limit(value: number | undefined, maximum: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.floor(value)))
    : maximum;
}

function normalize(text: string): string {
  return oneLine(text);
}

function headingOf(line: string): string | undefined {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("#")) return undefined;
  let index = 0;
  while (trimmed[index] === "#") index += 1;
  const heading = trimmed.slice(index).trim();
  return heading.length > 0 ? heading : undefined;
}

function sections(text: string): Array<{ heading: string; body: string }> {
  const result: Array<{ heading: string; body: string }> = [];
  let heading: string | undefined;
  let body: string[] = [];
  let fenced = false;
  const flush = (): void => {
    if (heading === undefined) return;
    result.push({ heading, body: normalize(body.join("\n")) });
  };
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      if (heading !== undefined) body.push(line);
      continue;
    }
    const next = fenced ? undefined : headingOf(line);
    if (next !== undefined) {
      flush();
      heading = next;
      body = [];
      continue;
    }
    if (heading !== undefined) body.push(line);
  }
  flush();
  return result;
}

function conflictsOf(sources: readonly InstructionSource[]): InstructionConflict[] {
  const first = new Map<string, { path: string; body: string }>();
  const conflicts: InstructionConflict[] = [];
  const reported = new Set<string>();
  for (const source of sources) {
    for (const section of sections(source.text)) {
      const previous = first.get(section.heading);
      if (previous === undefined) {
        first.set(section.heading, { path: source.path, body: section.body });
        continue;
      }
      if (previous.path === source.path || previous.body === section.body) continue;
      if (reported.has(section.heading)) continue;
      reported.add(section.heading);
      conflicts.push({ heading: section.heading, paths: [previous.path, source.path] });
    }
  }
  return conflicts;
}

function render(sources: readonly InstructionSource[]): string {
  return sources
    .map((source) => {
      const scope =
        source.kind === "nested" ? `\nApplies to files under: ${dirname(source.path)}` : "";
      return `## ${source.kind} instructions\n\nSource: ${source.path}${scope}\n\n${source.text}`;
    })
    .join("\n\n");
}

export async function loadInstructions(
  cwd: string,
  locations: InstructionLocations = {},
): Promise<InstructionBundle> {
  const defaults = defaultInstructionLocations(cwd);
  const seen = new Set<string>();
  const sources: InstructionSource[] = [];
  const budget = { remaining: MAX_INSTRUCTION_BYTES, limited: false };

  for (const kind of ["managed", "user", "project", "local"] as const) {
    sources.push(...(await readSources(kind, locations[kind] ?? defaults[kind], seen, budget)));
  }

  if (locations.nested ?? defaults.nested) {
    const nested = await discoverNestedInstructions(
      cwd,
      limit(locations.nestedMaxDepth ?? defaults.nestedMaxDepth, 16),
      limit(locations.nestedMaxFiles ?? defaults.nestedMaxFiles, DEFAULT_NESTED_FILES),
    );
    budget.limited = nested.limited;
    sources.push(...(await readSources("nested", nested.paths, seen, budget)));
  }

  return {
    sources,
    text: [
      render(sources),
      ...(locations.nested === false ? [] : [instructionDiscovery.trim()]),
      ...(budget.limited ? [instructionLimit.trim()] : []),
    ]
      .filter(Boolean)
      .join("\n\n"),
    conflicts: conflictsOf(sources),
  };
}
