export const NAME_ALIASES: Record<string, string> = {
  read_file: "read",
  readfile: "read",
  write_file: "write",
  writefile: "write",
  edit_file: "edit",
  editfile: "edit",
  str_replace: "edit",
  search: "grep",
  search_files: "grep",
  ripgrep: "grep",
  rg: "grep",
  find: "glob",
  find_files: "glob",
  file_search: "glob",
  shell: "bash",
  shell_command: "bash",
  run_command: "bash",
  execute: "bash",
  terminal: "bash",
  finish: "done",
  complete: "done",
  task_done: "done",
};

export const PRIMARY_FIELD: Record<string, string> = {
  read: "path",
  write: "path",
  edit: "path",
  grep: "pattern",
  glob: "pattern",
  bash: "command",
  done: "summary",
};

export const FIELD_ALIASES: Record<string, Record<string, string[]>> = {
  read: {
    path: [
      "file_path",
      "filePath",
      "filepath",
      "filename",
      "target_file",
      "absolute_path",
      "absolutePath",
    ],
    offset: ["start_line", "startLine", "line", "from_line"],
    limit: ["lines", "count", "maxLines", "num_lines"],
  },
  write: {
    path: [
      "file_path",
      "filePath",
      "filepath",
      "filename",
      "target_file",
      "absolute_path",
      "absolutePath",
    ],
    content: ["text", "body", "contents", "fileContent", "data"],
    why: ["reason"],
  },
  edit: {
    path: [
      "file_path",
      "filePath",
      "filepath",
      "filename",
      "target_file",
      "absolute_path",
      "absolutePath",
    ],
    oldString: ["old_string", "oldText", "old_text", "old", "old_str", "from"],
    newString: ["new_string", "newText", "new_text", "new", "new_str", "to"],
    why: ["reason"],
    replaceAll: ["replace_all", "all"],
  },
  grep: {
    pattern: ["query", "regex", "search", "q", "expression", "text"],
    path: ["directory", "dir", "folder", "searchPath", "search_path"],
    glob: ["include", "filter", "file_pattern"],
    maxResults: ["max_results", "limit"],
  },
  glob: {
    pattern: ["query", "glob", "expression", "search", "include"],
    path: ["directory", "dir", "folder", "searchPath", "search_path"],
    maxResults: ["max_results", "limit"],
  },
  bash: {
    command: ["cmd", "shell", "script", "commandLine", "command_line"],
    cwd: ["workdir", "working_directory", "workingDirectory", "dir", "directory"],
    timeoutMs: ["timeout_ms", "timeoutMS", "timeout"],
  },
  done: {
    summary: ["message", "result", "text"],
    evidence: ["proofs", "checks", "verification"],
  },
};

export const PATH_KEYS = new Set(["path", "cwd", "file_path", "filePath"]);

export function resolveToolAlias(
  name: string,
  known: ReadonlySet<string>,
): { name: string; note?: string } {
  if (known.has(name)) return { name };
  const alias = NAME_ALIASES[name] ?? NAME_ALIASES[name.toLowerCase()];
  if (alias && known.has(alias)) {
    return {
      name: alias,
      note: `The tool \`${name}\` is called \`${alias}\` here; this call ran as ${alias}. Call \`${alias}\` directly next time.`,
    };
  }
  return { name };
}
