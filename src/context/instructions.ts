import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { oneLine } from "../util/text";

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

const NESTED_NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".liquid",
  ".agents",
  ".kilo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
]);
const DEFAULT_NESTED_DEPTH = 3;
const DEFAULT_NESTED_FILES = 32;
const MAX_SCANNED_DIRECTORIES = 1000;

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
    ],
    project: [join(cwd, "AGENTS.md"), join(cwd, "CLAUDE.md")],
    local: [join(cwd, "AGENTS.local.md")],
    nested: true,
    nestedMaxDepth: DEFAULT_NESTED_DEPTH,
    nestedMaxFiles: DEFAULT_NESTED_FILES,
  };
}

async function readTextFile(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    const text = (await file.text()).trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function readSources(
  kind: InstructionKind,
  paths: readonly string[],
  seen: Set<string>,
): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = [];
  for (const candidate of paths) {
    const path = resolve(candidate);
    if (seen.has(path)) continue;
    const text = await readTextFile(path);
    if (text === undefined) continue;
    seen.add(path);
    sources.push({ kind, path, text });
  }
  return sources;
}

interface NestedScan {
  readonly root: string;
  readonly maxDepth: number;
  readonly maxFiles: number;
}

async function nestedSources(scan: NestedScan, seen: Set<string>): Promise<InstructionSource[]> {
  const found: string[] = [];
  let scanned = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > scan.maxDepth || found.length >= scan.maxFiles) return;
    if (scanned >= MAX_SCANNED_DIRECTORIES) return;
    scanned += 1;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= scan.maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(join(directory, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile() && NESTED_NAMES.has(entry.name)) found.push(join(directory, entry.name));
    }
  }

  await walk(scan.root, 1);
  const ordered = found.sort((left, right) => {
    const depthDifference =
      relative(scan.root, left).split(sep).length - relative(scan.root, right).split(sep).length;
    return depthDifference === 0 ? left.localeCompare(right) : depthDifference;
  });
  const sources: InstructionSource[] = [];
  for (const path of ordered) {
    if (seen.has(path)) continue;
    const text = await readTextFile(path);
    if (text === undefined) continue;
    seen.add(path);
    sources.push({ kind: "nested", path, text });
  }
  return sources;
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

  sources.push(...(await readSources("managed", locations.managed ?? defaults.managed, seen)));
  sources.push(...(await readSources("user", locations.user ?? defaults.user, seen)));
  sources.push(...(await readSources("project", locations.project ?? defaults.project, seen)));
  sources.push(...(await readSources("local", locations.local ?? defaults.local, seen)));

  if (locations.nested ?? defaults.nested) {
    sources.push(
      ...(await nestedSources(
        {
          root: cwd,
          maxDepth: locations.nestedMaxDepth ?? defaults.nestedMaxDepth,
          maxFiles: locations.nestedMaxFiles ?? defaults.nestedMaxFiles,
        },
        seen,
      )),
    );
  }

  return {
    sources,
    text: render(sources),
    conflicts: conflictsOf(sources),
  };
}
