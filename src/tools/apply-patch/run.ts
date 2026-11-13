import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ToolResult } from "../../core/types";
import { defineTool, type ToolContext } from "../types";
import { type DiffHunk, diffText } from "../util/diff";
import { displayPath, ensureInside, isInside, resolveToolPath } from "../util/paths";
import { type ApplyPatchArgs, applyPatchSpec } from "./schema";

type HunkLineKind = "context" | "add" | "delete";
interface HunkLine {
  kind: HunkLineKind;
  text: string;
}
interface Hunk {
  lines: HunkLine[];
}
interface PatchFile {
  kind: "add" | "update" | "delete";
  path: string;
  moveTo?: string;
  hunks: Hunk[];
  content: string[];
  line: number;
}
interface FileChange {
  path: string;
  display: string;
  previous: string | null;
  content: string | null;
}
interface ChangeSummary {
  path: string;
  from?: string;
  state: "A" | "M" | "D" | "R";
  add: number;
  del: number;
  hunks: DiffHunk[];
}
const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD_FILE = "*** Add File: ";
const UPDATE_FILE = "*** Update File: ";
const DELETE_FILE = "*** Delete File: ";
const MOVE_TO = "*** Move to: ";
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function failure(error: unknown): ToolResult {
  return { ok: false, output: "", error: message(error) };
}
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function headerPath(line: string, prefix: string, lineNumber: number): string {
  const path = line.slice(prefix.length).trim();
  if (path.length === 0) {
    throw new Error(`Line ${lineNumber}: ${prefix.trim()} needs a path`);
  }
  return path;
}
function validateFiles(files: PatchFile[]): void {
  if (files.length === 0) throw new Error("Patch has no files");
  const claimed = new Map<string, number>();
  const claim = (path: string, line: number): void => {
    const previous = claimed.get(path);
    if (previous !== undefined) {
      throw new Error(
        `Line ${line}: ${path} is already changed by the file section at line ${previous}`,
      );
    }
    claimed.set(path, line);
  };

  for (const file of files) {
    if (file.path.length === 0) throw new Error(`Line ${file.line}: empty file path`);
    claim(file.path, file.line);
    if (file.kind !== "update") continue;
    if (file.hunks.length === 0 && file.moveTo === undefined) {
      throw new Error(
        `Line ${file.line}: Update File needs at least one @@ hunk or a *** Move to line`,
      );
    }
    for (const [index, hunk] of file.hunks.entries()) {
      if (hunk.lines.length === 0) {
        throw new Error(`Line ${file.line}: hunk ${index + 1} is empty`);
      }
      if (!hunk.lines.some((line) => line.kind === "add" || line.kind === "delete")) {
        throw new Error(
          `Line ${file.line}: hunk ${index + 1} has no changed lines; a hunk needs + or - lines`,
        );
      }
    }
    if (file.moveTo !== undefined) {
      if (file.moveTo === file.path) {
        throw new Error(`Line ${file.line}: Move to must point at a different path`);
      }
      claim(file.moveTo, file.line);
    }
  }
}
export function parseApplyPatch(patch: string): PatchFile[] {
  const source = patch.startsWith("\uFEFF") ? patch.slice(1) : patch;
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  while (lines[index] === "") index += 1;
  if (lines[index] !== BEGIN) throw new Error(`Patch must start with ${BEGIN}`);
  index += 1;

  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  let hunk: Hunk | undefined;
  let ended = false;
  const begin = (kind: PatchFile["kind"], path: string, line: number): void => {
    current = { kind, path, hunks: [], content: [], line };
    files.push(current);
    hunk = undefined;
  };

  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    if (line === END) {
      ended = true;
      index += 1;
      break;
    }
    if (line.startsWith(ADD_FILE)) {
      begin("add", headerPath(line, ADD_FILE, lineNumber), lineNumber);
      continue;
    }
    if (line.startsWith(UPDATE_FILE)) {
      begin("update", headerPath(line, UPDATE_FILE, lineNumber), lineNumber);
      continue;
    }
    if (line.startsWith(DELETE_FILE)) {
      begin("delete", headerPath(line, DELETE_FILE, lineNumber), lineNumber);
      continue;
    }
    if (line.startsWith(MOVE_TO)) {
      if (current === undefined || current.kind !== "update") {
        throw new Error(`Line ${lineNumber}: ${MOVE_TO.trim()} is only valid inside Update File`);
      }
      if (current.moveTo !== undefined) {
        throw new Error(`Line ${lineNumber}: Move to is already set for ${current.path}`);
      }
      current.moveTo = headerPath(line, MOVE_TO, lineNumber);
      hunk = undefined;
      continue;
    }
    if (line.startsWith("@@")) {
      if (current === undefined || current.kind !== "update") {
        throw new Error(`Line ${lineNumber}: @@ is only valid inside Update File`);
      }
      hunk = { lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (line.startsWith("*** ")) {
      throw new Error(`Line ${lineNumber}: unknown patch header ${line.slice(0, 40)}`);
    }
    if (current === undefined) {
      throw new Error(`Line ${lineNumber}: expected a file header`);
    }
    if (current.kind === "add") {
      if (!line.startsWith("+")) {
        throw new Error(`Line ${lineNumber}: Add File content must start with +`);
      }
      current.content.push(line.slice(1));
      continue;
    }
    if (current.kind === "delete") {
      throw new Error(`Line ${lineNumber}: Delete File does not take content`);
    }
    if (hunk === undefined) {
      if (line === "") continue;
      throw new Error(`Line ${lineNumber}: expected @@ before update content`);
    }
    if (line === "") {
      hunk.lines.push({ kind: "context", text: "" });
      continue;
    }
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      hunk.lines.push({ kind: "delete", text: line.slice(1) });
      continue;
    }
    if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "context", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("\\")) continue;
    throw new Error(`Line ${lineNumber}: hunk line must start with a space, + or -`);
  }
  if (!ended) throw new Error(`Patch must end with ${END}`);
  for (; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().length > 0) {
      throw new Error(`Line ${index + 1}: unexpected text after ${END}`);
    }
  }
  validateFiles(files);
  return files;
}
function applyHunks(label: string, previous: string, hunks: Hunk[]): string {
  const ending = previous.includes("\r\n") ? "\r\n" : "\n";
  const normalized = previous.replaceAll("\r\n", "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (finalNewline) lines.pop();
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    const expected = hunk.lines.filter((line) => line.kind !== "add").map((line) => line.text);
    const replacement = hunk.lines
      .filter((line) => line.kind !== "delete")
      .map((line) => line.text);
    if (expected.length === 0) {
      throw new Error(`Hunk ${index + 1} for ${label} has only additions; add context lines`);
    }
    let at = -1;
    for (let start = cursor; start + expected.length <= lines.length; start += 1) {
      let matches = true;
      for (let offset = 0; offset < expected.length; offset += 1) {
        if (lines[start + offset] !== expected[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        at = start;
        break;
      }
    }
    if (at < 0) {
      throw new Error(
        `Hunk ${index + 1} for ${label} does not match the current file; read the file again and rebuild the patch`,
      );
    }
    lines.splice(at, expected.length, ...replacement);
    cursor = at + replacement.length;
  }
  if (lines.length === 0) return "";
  const body = lines.join("\n") + (finalNewline ? "\n" : "");
  return ending === "\r\n" ? body.replaceAll("\n", "\r\n") : body;
}

async function assertRealPathInside(cwd: string, input: string, start: string): Promise<void> {
  let current = start;
  while (true) {
    if (!isInside(cwd, current)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
    try {
      const real = await realpath(current);
      if (!isInside(cwd, real)) {
        throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
      }
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

async function mutationPath(cwd: string, input: string, why: string | undefined): Promise<string> {
  const path = resolveToolPath(cwd, input);
  ensureInside(cwd, path, why);
  await assertRealPathInside(cwd, input, dirname(path));
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info?.isSymbolicLink()) {
    const target = await realpath(path);
    if (!isInside(cwd, target)) {
      throw new Error(`Refusing to follow a symbolic link outside the workspace: ${input}`);
    }
  }
  return path;
}

async function checkSandbox(context: ToolContext, path: string): Promise<void> {
  if (context.sandbox === undefined) return;
  const decision = await context.sandbox.checkWrite(path);
  if (!decision.allowed) throw new Error(decision.reason);
}

async function readExisting(path: string, input: string): Promise<string | null> {
  const info = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (info === undefined) return null;
  if (info.isDirectory()) throw new Error(`${input} is a directory`);
  if (!info.isFile() && !info.isSymbolicLink()) {
    throw new Error(`${input} is not a regular file`);
  }
  return readFile(path, "utf8");
}

async function stageFile(path: string, content: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.liquid-tmp`);
  const info = await lstat(path).catch(() => undefined);
  const mode = info?.isFile() ? info.mode & 0o777 : undefined;
  await writeFile(temp, content, mode === undefined ? undefined : { mode });
  return temp;
}

async function restoreFile(path: string, content: string): Promise<void> {
  const temp = await stageFile(path, content);
  await rename(temp, path);
}

async function commitChanges(changes: FileChange[]): Promise<void> {
  const staged: Array<{ path: string; temp: string }> = [];
  try {
    for (const change of changes) {
      if (change.content === null) continue;
      staged.push({ path: change.path, temp: await stageFile(change.path, change.content) });
    }
    for (const entry of staged) await rename(entry.temp, entry.path);
    for (const change of changes) {
      if (change.content === null) await rm(change.path);
    }
  } catch (error) {
    await Promise.all(
      staged.map((entry) => rm(entry.temp, { force: true }).catch(() => undefined)),
    );
    for (const change of changes) {
      try {
        if (change.previous === null) await rm(change.path, { force: true });
        else await restoreFile(change.path, change.previous);
      } catch {}
    }
    throw error;
  }
}
function summarize(
  previous: string,
  content: string,
): Pick<ChangeSummary, "add" | "del" | "hunks"> {
  const diff = diffText(previous, content);
  return { add: diff.add, del: diff.del, hunks: diff.hunks };
}
export async function runApplyPatch(
  args: ApplyPatchArgs,
  context: ToolContext,
): Promise<ToolResult> {
  let files: PatchFile[];
  try {
    files = parseApplyPatch(args.patch);
  } catch (error) {
    return failure(error);
  }

  const changes: FileChange[] = [];
  const summaries: ChangeSummary[] = [];
  const seen = new Set<string>();

  try {
    context.signal.throwIfAborted();
    const resolved = new Map<PatchFile, string>();
    for (const file of files) {
      const path = await mutationPath(context.cwd, file.path, args.why);
      await checkSandbox(context, path);
      if (seen.has(path)) throw new Error(`Patch changes ${file.path} more than once`);
      seen.add(path);
      resolved.set(file, path);
    }

    for (const file of files) {
      const path = resolved.get(file);
      if (path === undefined) throw new Error(`Could not resolve ${file.path}`);
      const display = displayPath(context.cwd, path);
      const previous = await readExisting(path, file.path);

      if (file.kind === "add") {
        if (previous !== null) throw new Error(`Add File: ${file.path} already exists`);
        const content = file.content.join("\n");
        changes.push({ path, display, previous: null, content });
        summaries.push({ path: display, state: "A", ...summarize("", content) });
        continue;
      }

      if (file.kind === "delete") {
        if (previous === null) throw new Error(`Delete File: ${file.path} not found`);
        changes.push({ path, display, previous, content: null });
        summaries.push({ path: display, state: "D", ...summarize(previous, "") });
        continue;
      }

      if (previous === null) throw new Error(`Update File: ${file.path} not found`);
      const content =
        file.hunks.length === 0 ? previous : applyHunks(file.path, previous, file.hunks);

      if (file.moveTo === undefined) {
        changes.push({ path, display, previous, content });
        summaries.push({ path: display, state: "M", ...summarize(previous, content) });
        continue;
      }

      const targetPath = await mutationPath(context.cwd, file.moveTo, args.why);
      await checkSandbox(context, targetPath);
      if (seen.has(targetPath)) throw new Error(`Patch moves to ${file.moveTo} more than once`);
      seen.add(targetPath);
      const targetDisplay = displayPath(context.cwd, targetPath);
      const targetPrevious = await readExisting(targetPath, file.moveTo);
      if (targetPrevious !== null) throw new Error(`Move to: ${file.moveTo} already exists`);

      changes.push({ path, display, previous, content: null });
      changes.push({ path: targetPath, display: targetDisplay, previous: null, content });
      summaries.push({
        path: targetDisplay,
        from: display,
        state: "R",
        ...summarize(previous, content),
      });
    }
  } catch (error) {
    return failure(error);
  }

  const displays = changes.map((change) => change.display);
  let checkpointId: string | undefined;
  let checkpointNote = "";
  if (context.checkpoints) {
    try {
      const preImages: Record<string, { content: string } | null> = {};
      for (const change of changes) {
        preImages[change.display] = change.previous === null ? null : { content: change.previous };
      }
      const checkpoint = await context.checkpoints.capture({
        paths: displays,
        label: `apply_patch ${files.length} file(s)`,
        tool: "apply_patch",
        sessionId: context.sessionId,
        preImages,
      });
      checkpointId = checkpoint.id;
    } catch (error) {
      checkpointNote = `\nCheckpoint не создан: ${message(error)}`;
    }
  }

  try {
    await commitChanges(changes);
  } catch (error) {
    return failure(error);
  }

  for (const change of changes) {
    if (change.content === null) context.reads.forget(change.path);
    else context.reads.record(change.path, change.content);
  }

  if (checkpointId && context.checkpoints) {
    try {
      await context.checkpoints.recordAfter(checkpointId);
    } catch (error) {
      checkpointNote += `\nCheckpoint не завершён: ${message(error)}`;
    }
  }

  const add = summaries.reduce((total, file) => total + file.add, 0);
  const del = summaries.reduce((total, file) => total + file.del, 0);
  const lines = summaries.map((file) => {
    const label = file.from === undefined ? file.path : `${file.from} -> ${file.path}`;
    return `${file.state} ${label} (+${file.add} -${file.del})`;
  });
  const output = [`Applied patch to ${summaries.length} file(s) (+${add} -${del})`, ...lines].join(
    "\n",
  );

  return {
    ok: true,
    output: `${output}${checkpointNote}`,
    data: {
      kind: "patch",
      files: summaries,
      add,
      del,
      ...(checkpointId ? { checkpointId } : {}),
    },
  };
}
export const applyPatchTool = defineTool({
  ...applyPatchSpec,
  mutating: true,
  execute: runApplyPatch,
});
