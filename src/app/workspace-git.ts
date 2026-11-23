import { z } from "zod";
import { redact } from "../util/redact";
import { previewFile } from "./file-preview";

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("diff"), path: z.string().min(1), staged: z.boolean() }),
  z.object({ action: z.enum(["stage", "unstage"]), path: z.string().min(1) }),
  z.object({ action: z.literal("commit"), message: z.string().trim().min(1).max(10000) }),
]);
interface GitEntry {
  path: string;
  original?: string;
  index: string;
  worktree: string;
}
async function git(cwd: string, args: string[], allowFailure = false): Promise<string> {
  let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    process = Bun.spawn(["git", "--no-optional-locks", "--literal-pathspecs", ...args], {
      cwd,
      env: { ...globalThis.process.env, GIT_TERMINAL_PROMPT: "0" },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(
      redact(error instanceof Error ? error.message : String(error)) ||
        "Git is not available. Install Git to use Source Control.",
    );
  }
  const timer = setTimeout(() => process.kill(), 15_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (code !== 0 && !allowFailure)
      throw new Error(redact(stderr.trim()) || "Git command failed. Check repository status.");
    return code === 0 ? stdout : "";
  } finally {
    clearTimeout(timer);
  }
}
async function status(
  cwd: string,
): Promise<{ branch: string; entries: GitEntry[]; repository: boolean }> {
  if (!(await git(cwd, ["rev-parse", "--is-inside-work-tree"], true)).trim())
    return { branch: "", entries: [], repository: false };
  const records = (
    await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."])
  ).split("\0");
  const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).trim();
  const entries: GitEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const rawPath = record.slice(3);
    const path = prefix && rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
    const entry: GitEntry = { path, index: record[0] ?? " ", worktree: record[1] ?? " " };
    if ([entry.index, entry.worktree].some((state) => state === "R" || state === "C"))
      entry.original = records[++index] ?? "";
    if (entry.original && prefix && entry.original.startsWith(prefix))
      entry.original = entry.original.slice(prefix.length);
    if (![".git", ".flecten", ".liquid", ".flecten-migration"].includes(path.split("/")[0] ?? ""))
      entries.push(entry);
  }
  const branch =
    (await git(cwd, ["branch", "--show-current"])).trim() ||
    (await git(cwd, ["rev-parse", "--short", "HEAD"], true)).trim();
  return { branch, entries, repository: true };
}
/** All mutations are explicit UI actions. Arguments never pass through a shell. */
export async function workspaceGit(cwd: string, input: unknown): Promise<unknown> {
  const command = Command.parse(input);
  const current = await status(cwd);
  if (command.action === "status") return current;
  if (!current.repository) throw new Error("No Git repository in this folder.");
  if (command.action === "commit") {
    const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).trim();
    const visible = new Set(
      current.entries
        .filter((entry) => entry.index !== " " && entry.index !== "?")
        .flatMap((entry) => [entry.path, ...(entry.original ? [entry.original] : [])])
        .map((path) => prefix + path),
    );
    const staged = (await git(cwd, ["diff", "--cached", "--name-only", "-z"]))
      .split("\0")
      .filter(Boolean);
    if (staged.some((path) => !visible.has(path)))
      throw new Error(
        "Staged changes include files outside the open project. Open the repository root to commit.",
      );
    await git(cwd, ["commit", "-m", command.message]);
    return status(cwd);
  }
  const entry = current.entries.find((entry) => entry.path === command.path);
  if (!entry) throw new Error("Change no longer exists. Refresh Git status.");
  if (command.action === "diff") {
    const text =
      entry.index === "?"
        ? (await previewFile(cwd, entry.path)).text
        : await git(cwd, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            ...(command.staged ? ["--cached"] : []),
            "--",
            entry.path,
          ]);
    return { path: entry.path, text: redact(text).slice(0, 512 * 1024), staged: command.staged };
  }
  const paths = entry.original ? [entry.original, entry.path] : [entry.path];
  if (command.action === "stage") await git(cwd, ["add", "--", ...paths]);
  else if ((await git(cwd, ["rev-parse", "--verify", "HEAD"], true)).trim())
    await git(cwd, ["restore", "--staged", "--", ...paths]);
  else await git(cwd, ["rm", "--cached", "--", ...paths]);
  return status(cwd);
}
