import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/**
 * A private git repository in `.liquid/shadow` that indexes the workspace for shell checkpoints.
 * It never writes to the user's repository: the user's object database is read through
 * `objects/info/alternates` and the user's index is copied once as a warm stat cache.
 */

export interface GitOutput {
  code: number;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

export interface GitCall {
  input?: Uint8Array | string;
  /** Epoch ms after which the process is killed and the call reports `timedOut`. */
  deadline?: number;
  /** Stop reading once stdout holds this many bytes; the call then reports `truncated`. */
  maxOutputBytes?: number;
}

const SHADOW_CONFIG = `[core]
\tautocrlf = false
\tfsmonitor = false
\thooksPath = /dev/null
\tuntrackedCache = true
\tquotePath = false
\tcompression = 0
\tlooseCompression = 0
\tsafecrlf = false
\tsplitIndex = false
[gc]
\tauto = 0
[index]
\tsparse = false
[maintenance]
\tauto = false
`;

/** Content goes into the shadow repository byte for byte: no line ending or filter conversion. */
const SHADOW_ATTRIBUTES = "* -text -filter -eol -ident -working-tree-encoding -diff\n";

export class ShadowGit {
  readonly gitDir: string;
  readonly workTree: string;
  readonly #binary: string;

  constructor(workTree: string, gitDir: string, binary = "git") {
    this.workTree = resolve(workTree);
    this.gitDir = resolve(gitDir);
    this.#binary = binary;
  }

  get indexFile(): string {
    return join(this.gitDir, "index");
  }

  env(): Record<string, string> {
    return {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/",
      GIT_DIR: this.gitDir,
      GIT_WORK_TREE: this.workTree,
      GIT_INDEX_FILE: this.indexFile,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
      LC_ALL: "C",
    };
  }

  async run(
    args: readonly string[],
    call: GitCall = {},
  ): Promise<GitOutput & { truncated: boolean }> {
    return runGit(this.#binary, args, this.workTree, this.env(), call);
  }

  /** Creates the repository once; returns false when git is missing or init fails. */
  async ensure(): Promise<boolean> {
    if (existsSync(join(this.gitDir, "HEAD"))) return true;
    await mkdir(this.gitDir, { recursive: true });
    const init = await this.run(["init", "--quiet"]).catch(() => undefined);
    if (init === undefined || init.code !== 0) return false;
    const config = await readFile(join(this.gitDir, "config"), "utf8");
    await writeFile(join(this.gitDir, "config"), `${config}${SHADOW_CONFIG}`);
    await mkdir(join(this.gitDir, "info"), { recursive: true });
    await writeFile(join(this.gitDir, "info", "attributes"), SHADOW_ATTRIBUTES);
    await rm(join(this.gitDir, "hooks"), { recursive: true, force: true });
    return true;
  }

  /** Mirrors the user's exclude file so both repositories ignore the same files. */
  async writeExcludes(userGitDir: string | undefined, extra: readonly string[]): Promise<void> {
    const own = extra.map((line) => `${line}\n`).join("");
    const user =
      userGitDir === undefined
        ? ""
        : await readFile(join(userGitDir, "info", "exclude"), "utf8").catch(() => "");
    await writeFile(join(this.gitDir, "info", "exclude"), `${own}${user}`);
  }

  async linkObjects(userObjects: string | undefined): Promise<void> {
    const file = join(this.gitDir, "objects", "info", "alternates");
    if (userObjects === undefined) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(join(this.gitDir, "objects", "info"), { recursive: true });
    await writeFile(file, `${userObjects}\n`);
  }

  async seedIndex(userIndex: string): Promise<void> {
    await copyFile(userIndex, this.indexFile);
  }

  async clearLock(): Promise<void> {
    await rm(`${this.indexFile}.lock`, { force: true });
  }
}

/** Where the user's repository keeps its objects and index, without writing to it. */
export interface UserRepo {
  gitDir: string;
  commonDir: string;
  /** Repository settings that make a copied index unsafe to reuse as a byte-exact cache. */
  converts: boolean;
}

export async function findUserRepo(
  workTree: string,
  binary = "git",
): Promise<UserRepo | undefined> {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/",
    LC_ALL: "C",
  };
  const out = await runGit(
    binary,
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
    workTree,
    { ...env, GIT_OPTIONAL_LOCKS: "0" },
    { deadline: Date.now() + 2000 },
  ).catch(() => undefined);
  if (out === undefined || out.code !== 0) return undefined;
  const [top, gitDir, commonDir] = out.stdout.toString("utf8").split("\n");
  if (!top || !gitDir || !commonDir || resolve(top) !== resolve(workTree)) return undefined;
  const settings = await runGit(binary, ["config", "--list", "--null"], workTree, env, {
    deadline: Date.now() + 2000,
  }).catch(() => undefined);
  const converts = settingsConvert(settings?.code === 0 ? settings.stdout.toString("utf8") : "");
  return {
    gitDir: isAbsolute(gitDir) ? gitDir : resolve(workTree, gitDir),
    commonDir: isAbsolute(commonDir) ? commonDir : resolve(workTree, commonDir),
    converts,
  };
}

/** Settings that rewrite content between the work tree and the index, or change the index format. */
const CONVERTING_KEYS = new Set(["core.autocrlf", "core.splitindex", "index.sparse"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/** `git config --list --null` prints `key\nvalue\0` entries. */
function settingsConvert(raw: string): boolean {
  for (const entry of raw.split("\0")) {
    if (entry.length === 0) continue;
    const newline = entry.indexOf("\n");
    const key = (newline < 0 ? entry : entry.slice(0, newline)).toLowerCase();
    const value = (newline < 0 ? "true" : entry.slice(newline + 1)).toLowerCase();
    if (key === "core.attributesfile") return true;
    if (CONVERTING_KEYS.has(key) && !FALSE_VALUES.has(value)) return true;
  }
  return false;
}

export async function runGit(
  binary: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  call: GitCall = {},
): Promise<GitOutput & { truncated: boolean }> {
  const proc = Bun.spawn({
    cmd: [binary, ...args],
    cwd,
    env,
    stdin: call.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let truncated = false;
  const remaining = call.deadline === undefined ? undefined : call.deadline - Date.now();
  const timer =
    remaining === undefined
      ? undefined
      : setTimeout(
          () => {
            timedOut = true;
            proc.kill("SIGKILL");
          },
          Math.max(0, remaining),
        );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = (async () => {
    for await (const chunk of proc.stdout) {
      if (call.maxOutputBytes !== undefined && bytes + chunk.byteLength > call.maxOutputBytes) {
        truncated = true;
        proc.kill("SIGKILL");
        break;
      }
      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
  })();
  const writer = (async () => {
    if (call.input === undefined || !proc.stdin) return;
    try {
      proc.stdin.write(call.input);
      await proc.stdin.end();
    } catch {
      // The process exited before reading all input; its exit code tells the caller.
    }
  })();
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    reader,
    writer,
  ]).then(([exit, text]) => [exit, text] as const);
  if (timer !== undefined) clearTimeout(timer);
  return { code, stdout: Buffer.concat(chunks), stderr, timedOut, truncated };
}
