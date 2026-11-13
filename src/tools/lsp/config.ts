import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { withoutPrefix } from "../../util/text";
import { isInside } from "../util/paths";
import type { LspServerConfig } from "./client";

export interface LspServerDefinition {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  envAllowlist?: string[];
  filetypes?: string[];
  rootMarkers?: string[];
  timeoutMs?: number;
}

export type LspFormatterDefinition = LspServerDefinition;

export type LspDefinitionList = LspServerDefinition[] | Record<string, LspServerDefinition>;

export interface LspConfig {
  servers?: LspDefinitionList;
  formatters?: LspDefinitionList;
}

export type LspContextConfig = LspConfig | LspServerConfig;

export interface ResolvedFormatter {
  definition: LspFormatterDefinition;
  root: string;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

const BASE_ENV_NAMES = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LANG",
  "LC_ALL",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "c",
  ".cpp": "cpp",
  ".css": "css",
  ".go": "go",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".jsx": "javascriptreact",
  ".md": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shellscript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export const DEFAULT_LSP_CONFIG: LspConfig = {
  servers: [
    {
      command: "typescript-language-server",
      args: ["--stdio"],
      filetypes: ["ts", "tsx", "js", "jsx", "mjs", "mts"],
      rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    {
      command: "pyright-langserver",
      args: ["--stdio"],
      filetypes: ["py"],
      rootMarkers: ["pyrightconfig.json", "pyproject.toml", "setup.py"],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    {
      command: "rust-analyzer",
      filetypes: ["rs"],
      rootMarkers: ["Cargo.toml"],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    {
      command: "gopls",
      filetypes: ["go"],
      rootMarkers: ["go.mod"],
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  ],
  formatters: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isDefinition(value: unknown): value is LspServerDefinition {
  if (!isRecord(value) || typeof value.command !== "string" || value.command.trim().length === 0) {
    return false;
  }
  if (value.args !== undefined && !isStringArray(value.args)) return false;
  if (value.cwd !== undefined && typeof value.cwd !== "string") return false;
  if (value.env !== undefined && !isStringRecord(value.env)) return false;
  if (value.envAllowlist !== undefined && !isStringArray(value.envAllowlist)) return false;
  if (value.filetypes !== undefined && !isStringArray(value.filetypes)) return false;
  if (value.rootMarkers !== undefined && !isStringArray(value.rootMarkers)) return false;
  if (value.timeoutMs !== undefined && typeof value.timeoutMs !== "number") return false;
  return true;
}

export function isLspConfig(value: LspContextConfig): value is LspConfig {
  return "servers" in value || "formatters" in value;
}

export function languageIdForFile(file: string): string {
  return LANGUAGE_BY_EXTENSION[extname(file).toLowerCase()] ?? "plaintext";
}

function normalizeFiletype(value: string): string {
  return withoutPrefix(value.trim(), ".").toLowerCase();
}

export function matchesFiletype(definition: LspServerDefinition, file: string): boolean {
  const filetypes = definition.filetypes;
  if (!Array.isArray(filetypes) || filetypes.length === 0) return true;
  const extension = normalizeFiletype(extname(file));
  const language = languageIdForFile(file);
  const name = basename(file).toLowerCase();
  return filetypes.some((item) => {
    if (typeof item !== "string") return false;
    const value = normalizeFiletype(item);
    return value === extension || value === language || value === name;
  });
}

function hasMarker(directory: string, markers: readonly string[]): boolean {
  return markers.some(
    (marker) =>
      typeof marker === "string" && marker.length > 0 && existsSync(resolve(directory, marker)),
  );
}

export function resolveRoot(
  file: string,
  workspace: string,
  rootMarkers: readonly string[] | undefined,
): string {
  const root = resolve(workspace);
  if (!Array.isArray(rootMarkers) || rootMarkers.length === 0) return root;
  let directory = dirname(resolve(file));
  while (isInside(root, directory)) {
    if (hasMarker(directory, rootMarkers)) return directory;
    if (directory === root) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return root;
}

function clampTimeout(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, MAX_TIMEOUT_MS);
}

function definitionsFrom(value: unknown): LspServerDefinition[] {
  if (Array.isArray(value)) return value.filter(isDefinition);
  if (isRecord(value)) return Object.values(value).filter(isDefinition);
  return [];
}

function serverDefinitions(value: LspContextConfig | undefined): LspServerDefinition[] {
  if (value === undefined) return definitionsFrom(DEFAULT_LSP_CONFIG.servers);
  if (isLspConfig(value)) return definitionsFrom(value.servers);
  return [
    {
      command: value.command,
      ...(value.args !== undefined ? { args: value.args } : {}),
      ...(value.cwd !== undefined ? { cwd: value.cwd } : {}),
      ...(value.env !== undefined ? { env: value.env } : {}),
      ...(value.envAllowlist !== undefined ? { envAllowlist: value.envAllowlist } : {}),
      ...(value.requestTimeoutMs !== undefined ? { timeoutMs: value.requestTimeoutMs } : {}),
    },
  ].filter(isDefinition);
}

function formatterDefinitions(value: LspContextConfig | undefined): LspFormatterDefinition[] {
  if (value === undefined || !isLspConfig(value)) return [];
  return definitionsFrom(value.formatters);
}

export function resolveServer(
  value: LspContextConfig | undefined,
  file: string,
  workspace: string,
): LspServerConfig | undefined {
  const definition = serverDefinitions(value).find((item) => matchesFiletype(item, file));
  if (!definition) return undefined;
  const root = definition.cwd
    ? resolve(workspace, definition.cwd)
    : resolveRoot(file, workspace, definition.rootMarkers);
  const timeoutMs = clampTimeout(definition.timeoutMs);
  return {
    command: definition.command,
    ...(definition.args !== undefined ? { args: definition.args } : {}),
    ...(definition.env !== undefined ? { env: definition.env } : {}),
    ...(definition.envAllowlist !== undefined ? { envAllowlist: definition.envAllowlist } : {}),
    cwd: root,
    ...(timeoutMs !== undefined
      ? { requestTimeoutMs: timeoutMs, diagnosticsTimeoutMs: timeoutMs }
      : {}),
  };
}

export function resolveFormatter(
  value: LspContextConfig | undefined,
  file: string,
  workspace: string,
): ResolvedFormatter | undefined {
  const definition = formatterDefinitions(value).find((item) => matchesFiletype(item, file));
  if (!definition) return undefined;
  const configured = definition.cwd
    ? resolve(workspace, definition.cwd)
    : resolveRoot(file, workspace, definition.rootMarkers);
  const root = isInside(workspace, configured) ? configured : resolve(workspace);
  return { definition, root };
}

export function childEnv(
  env: Record<string, string> | undefined,
  allowlist: readonly string[] | undefined,
): Record<string, string> {
  if (!Array.isArray(allowlist))
    return { ...process.env, ...(env ?? {}) } as Record<string, string>;
  const result: Record<string, string> = {};
  for (const name of [...BASE_ENV_NAMES, ...allowlist]) {
    if (typeof name !== "string") continue;
    const value = process.env[name];
    if (value !== undefined) result[name] = value;
  }
  return { ...result, ...(env ?? {}) };
}
