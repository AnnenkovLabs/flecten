import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseShell, programName, type ShellWord, type SimpleCommand } from "./shell-lexer";

/**
 * What a destructive command can reach. `workspace` means files that a shell checkpoint can
 * capture and undo. `outside` means remotes, git history, containers, disks or the system:
 * no local undo exists, so the user confirms by name.
 */
export type DestructiveReach = "workspace" | "outside";

export interface DestructiveRule {
  id: string;
  program: string;
  /** Positional words after the program, compared exactly: `["stash", "drop"]`. */
  subcommand?: readonly string[];
  /** The rule matches only when one of these flags is present. Short flags may be combined. */
  flags?: readonly string[];
  label: string;
  reach: DestructiveReach;
  /**
   * What the positional words name: `paths` (default), `leading-paths` when only the words before
   * the first option are paths (`find dir -name x`), or `tree` when the command acts on the whole
   * working tree and its words are revisions, as `git reset --hard HEAD~1`.
   */
  operands?: "paths" | "leading-paths" | "tree";
  /** With no path operand the command acts on the current directory, as `git clean -f`. */
  emptyMeansCwd?: boolean;
  /** The command can delete the `.git` directory itself, which no snapshot holds. */
  deletesGitDir?: boolean;
  /** `never`: the snapshot always covers it; the rule only tells the snapshot what to include. */
  confirm?: "never";
}

export interface DestructiveMatch {
  rule: DestructiveRule;
  argv: string[];
  /** Positional words after the subcommand, usually paths. */
  targets: string[];
  /** The same words with their expansion flags. */
  words: ShellWord[];
  /** A target holds `$`, `~`, a glob or a substitution, so its final value is unknown. */
  dynamic: boolean;
  /** Directory the targets are relative to when the command changes it, as `git -C dir`. */
  base?: string;
}

type RuleExtra = Pick<
  DestructiveRule,
  "subcommand" | "flags" | "operands" | "emptyMeansCwd" | "deletesGitDir" | "confirm"
>;

const rule = (
  id: string,
  program: string,
  label: string,
  reach: DestructiveReach,
  extra: RuleExtra = {},
): DestructiveRule => ({ id, program, label, reach, ...extra });

const DOCKER_SUBCOMMANDS: readonly (readonly string[])[] = [
  ["rm"],
  ["rmi"],
  ["system", "prune"],
  ["volume", "rm"],
  ["volume", "prune"],
  ["container", "prune"],
  ["image", "prune"],
  ["network", "prune"],
];

const DISK_PROGRAMS = [
  "dd",
  "mkfs",
  "mkfs.ext2",
  "mkfs.ext3",
  "mkfs.ext4",
  "mkfs.xfs",
  "mkfs.btrfs",
  "mkfs.vfat",
  "mkfs.fat",
  "mkfs.ntfs",
  "mke2fs",
  "newfs",
  "shred",
  "wipefs",
  "fdisk",
  "sfdisk",
  "gdisk",
  "parted",
];

export const DEFAULT_DESTRUCTIVE_RULES: readonly DestructiveRule[] = [
  rule("rm-files", "rm", "Удаление файлов", "workspace", { confirm: "never" }),
  rule("rm-recursive", "rm", "Рекурсивное удаление", "workspace", {
    flags: ["-r", "-R", "--recursive"],
    deletesGitDir: true,
  }),
  rule("git-clean", "git", "Удаление неотслеживаемых файлов", "workspace", {
    subcommand: ["clean"],
    flags: ["-f", "--force"],
    emptyMeansCwd: true,
  }),
  rule("git-clean-ignored", "git", "Удаление игнорируемых файлов", "workspace", {
    subcommand: ["clean"],
    flags: ["-x", "-X"],
    emptyMeansCwd: true,
  }),
  rule("git-reset-hard", "git", "Сброс рабочей копии и HEAD", "workspace", {
    subcommand: ["reset"],
    flags: ["--hard"],
    operands: "tree",
  }),
  rule("git-push-force", "git", "Перезапись истории на удалённом репозитории", "outside", {
    subcommand: ["push"],
    flags: ["-f", "--force", "--force-with-lease", "--mirror", "-d", "--delete"],
  }),
  rule("git-branch-delete", "git", "Удаление ветки без проверки слияния", "outside", {
    subcommand: ["branch"],
    flags: ["-D"],
  }),
  rule("git-stash-drop", "git", "Удаление сохранённых изменений", "outside", {
    subcommand: ["stash", "drop"],
  }),
  rule("git-stash-clear", "git", "Удаление всех сохранённых изменений", "outside", {
    subcommand: ["stash", "clear"],
  }),
  rule("git-filter-branch", "git", "Переписывание истории", "outside", {
    subcommand: ["filter-branch"],
  }),
  rule("git-filter-repo", "git", "Переписывание истории", "outside", {
    subcommand: ["filter-repo"],
  }),
  rule("git-reflog-expire", "git", "Удаление журнала ссылок", "outside", {
    subcommand: ["reflog", "expire"],
  }),
  ...DISK_PROGRAMS.map((program) => rule(`disk-${program}`, program, "Запись на диск", "outside")),
  ...["docker", "podman"].flatMap((program) =>
    DOCKER_SUBCOMMANDS.map((subcommand) =>
      rule(
        `${program}-${subcommand.join("-")}`,
        program,
        "Удаление контейнеров или данных",
        "outside",
        {
          subcommand: [...subcommand],
        },
      ),
    ),
  ),
  rule("kubectl-delete", "kubectl", "Удаление ресурсов кластера", "outside", {
    subcommand: ["delete"],
  }),
  rule("helm-uninstall", "helm", "Удаление релиза", "outside", { subcommand: ["uninstall"] }),
  rule("terraform-destroy", "terraform", "Удаление инфраструктуры", "outside", {
    subcommand: ["destroy"],
  }),
  rule("npm-publish", "npm", "Публикация пакета", "outside", { subcommand: ["publish"] }),
  rule("npm-unpublish", "npm", "Снятие пакета с публикации", "outside", {
    subcommand: ["unpublish"],
  }),
  rule("pnpm-publish", "pnpm", "Публикация пакета", "outside", { subcommand: ["publish"] }),
  rule("cargo-publish", "cargo", "Публикация пакета", "outside", { subcommand: ["publish"] }),
  rule("gh-repo-delete", "gh", "Удаление репозитория", "outside", {
    subcommand: ["repo", "delete"],
  }),
  rule("gh-release-delete", "gh", "Удаление релиза", "outside", {
    subcommand: ["release", "delete"],
  }),
  rule("aws-s3-rm", "aws", "Удаление объектов S3", "outside", { subcommand: ["s3", "rm"] }),
  rule("aws-s3-rb", "aws", "Удаление бакета S3", "outside", { subcommand: ["s3", "rb"] }),
  rule("crontab-remove", "crontab", "Удаление всех задач cron", "outside", { flags: ["-r"] }),
  ...["shutdown", "reboot", "halt", "poweroff"].map((program) =>
    rule(`system-${program}`, program, "Выключение или перезагрузка системы", "outside"),
  ),
  rule("find-delete", "find", "Удаление найденных файлов", "workspace", {
    flags: ["-delete"],
    operands: "leading-paths",
    emptyMeansCwd: true,
    deletesGitDir: true,
  }),
];

/** Programs that run another program; the policy looks through them. */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "nice",
  "nohup",
  "command",
  "builtin",
  "exec",
  "timeout",
  "stdbuf",
  "ionice",
  "xargs",
  "caffeinate",
  "chronic",
]);
/** Wrapper flags that consume the next word as their value. */
const WRAPPER_VALUE_FLAGS = new Set([
  "-u",
  "-g",
  "-n",
  "-c",
  "-p",
  "-s",
  "-k",
  "-I",
  "-L",
  "-P",
  "-d",
]);
/** Git options that come before the subcommand and take a value. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const SAFE_DEVICES = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/zero", "/dev/tty"]);

const DEVICE_RULE = rule("device-write", ">", "Запись в устройство", "outside");

function values(words: readonly ShellWord[]): string[] {
  return words.map((word) => word.value);
}

/** Drops wrapper programs such as `sudo -u x env A=1 timeout 5`. */
function unwrap(argv: readonly ShellWord[]): ShellWord[] {
  let index = 0;
  while (index < argv.length && WRAPPERS.has(programName(argv[index]?.value ?? ""))) {
    const wrapper = programName(argv[index]?.value ?? "");
    index += 1;
    while (index < argv.length) {
      const word = argv[index]?.value ?? "";
      if (word.startsWith("-")) {
        index += WRAPPER_VALUE_FLAGS.has(word) ? 2 : 1;
        continue;
      }
      if (wrapper === "env" && word.includes("=")) {
        index += 1;
        continue;
      }
      if (wrapper === "timeout") index += 1;
      break;
    }
  }
  return argv.slice(index);
}

/** Expands `-rf` to `-r -f`; long flags lose their `=value`. */
function flagSet(words: readonly string[]): Set<string> {
  const flags = new Set<string>();
  for (const word of words) {
    if (word === "--") break;
    if (word === "-") continue;
    if (word.startsWith("--")) {
      const equals = word.indexOf("=");
      flags.add(equals >= 0 ? word.slice(0, equals) : word);
    } else if (word.startsWith("-")) {
      flags.add(word);
      for (const char of word.slice(1)) flags.add(`-${char}`);
    }
  }
  return flags;
}

/** Positional words of a git command after its global options, and its `-C` directory. */
function gitPositionals(words: readonly string[]): { start: number; base?: string } {
  let index = 1;
  let base: string | undefined;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (!word.startsWith("-")) break;
    if (word === "-C") base = words[index + 1];
    if (word.startsWith("--work-tree=")) base = word.slice("--work-tree=".length);
    index += GIT_VALUE_OPTIONS.has(word) ? 2 : 1;
  }
  return base === undefined ? { start: index } : { start: index, base };
}

function positionals(words: readonly string[], from: number): string[] {
  const out: string[] = [];
  let afterDashes = false;
  for (const word of words.slice(from)) {
    if (!afterDashes && word === "--") {
      afterDashes = true;
      continue;
    }
    if (afterDashes || !word.startsWith("-")) out.push(word);
  }
  return out;
}

/** `find a b -name x`: the start points are the words before the expression. */
function leadingWords(words: readonly string[], from: number): string[] {
  const out: string[] = [];
  for (const word of words.slice(from)) {
    if (word.startsWith("-") || word === "(" || word === "!") break;
    out.push(word);
  }
  return out;
}

function matchRule(
  candidate: DestructiveRule,
  argv: readonly ShellWord[],
  words: readonly string[],
): DestructiveMatch | null {
  if (programName(words[0] ?? "") !== candidate.program) return null;
  const git = candidate.program === "git" ? gitPositionals(words) : { start: 1 };
  const start = git.start;
  const args = positionals(words, start);
  const subcommand = candidate.subcommand ?? [];
  for (let index = 0; index < subcommand.length; index += 1) {
    if (args[index] !== subcommand[index]) return null;
  }
  const rest = words.slice(start);
  if (candidate.flags && candidate.flags.length > 0) {
    const present = flagSet(rest);
    if (!candidate.flags.some((flag) => present.has(flag))) return null;
  }
  const targets =
    candidate.operands === "leading-paths"
      ? leadingWords(words, start)
      : args.slice(subcommand.length);
  const targetWords = argv.filter((word) => targets.includes(word.value));
  return {
    rule: candidate,
    argv: [...words],
    targets,
    words: targetWords,
    dynamic: targetWords.some((word) => word.dynamic),
    ...(git.base === undefined ? {} : { base: git.base }),
  };
}

function findExecCommands(words: readonly ShellWord[]): ShellWord[][] {
  const nested: ShellWord[][] = [];
  for (let index = 0; index < words.length; index += 1) {
    if (!FIND_EXEC.has(words[index]?.value ?? "")) continue;
    const inner: ShellWord[] = [];
    for (index += 1; index < words.length; index += 1) {
      const value = words[index]?.value ?? "";
      if (value === ";" || value === "+") break;
      const word = words[index] as ShellWord;
      // `{}` stands for every file find visits: its value is known only at run time.
      inner.push(value === "{}" ? { ...word, dynamic: true, expands: true } : word);
    }
    if (inner.length > 0) nested.push(inner);
  }
  return nested;
}

function matchCommand(
  command: SimpleCommand,
  rules: readonly DestructiveRule[],
  out: DestructiveMatch[],
): void {
  for (const redirect of command.redirects) {
    const target = redirect.target;
    if (redirect.op !== "<" && target.startsWith("/dev/") && !SAFE_DEVICES.has(target)) {
      out.push({
        rule: DEVICE_RULE,
        argv: [target],
        targets: [target],
        words: [{ value: target, dynamic: false, expands: false, glob: false }],
        dynamic: false,
      });
    }
  }
  const argv = unwrap(command.argv);
  if (argv.length === 0) return;
  const words = values(argv);
  for (const candidate of rules) {
    const match = matchRule(candidate, argv, words);
    if (match) out.push(match);
  }
  if (programName(words[0] ?? "") === "find") {
    for (const inner of findExecCommands(argv)) {
      matchCommand({ argv: inner, assignments: [], redirects: [] }, rules, out);
    }
  }
}

/** Every destructive operation a shell line would run, in order. */
export function findDestructive(
  line: string,
  rules: readonly DestructiveRule[] = DEFAULT_DESTRUCTIVE_RULES,
): DestructiveMatch[] {
  const parsed = parseShell(line);
  const out: DestructiveMatch[] = [];
  for (const command of parsed.commands) matchCommand(command, rules, out);
  return out;
}

export type TargetVerdict =
  | { kind: "inside"; path: string; glob: boolean }
  | { kind: "outside"; path: string }
  | { kind: "unknown"; word: string }
  | { kind: "git-dir"; path: string };

const GLOB_START = new Set(["*", "?", "["]);

/** The directory part of a glob before its first wildcard: `build/*.o` gives `build`. */
function globBase(word: string): { base: string; rest: string } {
  let cut = word.length;
  for (let index = 0; index < word.length; index += 1) {
    if (GLOB_START.has(word[index] ?? "")) {
      cut = index;
      break;
    }
  }
  const slash = word.lastIndexOf("/", cut);
  if (slash < 0) return { base: ".", rest: word };
  return { base: word.slice(0, slash) || "/", rest: word.slice(slash + 1) };
}

function insideOf(root: string, absolute: string): string | undefined {
  const inside = relative(root, absolute);
  const escapes = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  return escapes ? undefined : inside || ".";
}

function coversGitDir(path: string, rest: string | undefined): boolean {
  if (path === ".git" || path.startsWith(`.git${sep}`)) return true;
  if (path !== ".") return false;
  return rest === undefined || rest.startsWith(".");
}

/** Where a match's targets land relative to the workspace. Unknown means it cannot be undone safely. */
export function classifyTargets(
  match: DestructiveMatch,
  cwd: string,
  root: string,
): TargetVerdict[] {
  const base = match.base === undefined ? cwd : resolve(cwd, match.base);
  if (match.rule.operands === "tree") {
    const path = insideOf(root, base);
    return [
      path === undefined ? { kind: "outside", path: base } : { kind: "inside", path, glob: false },
    ];
  }
  const words =
    match.words.length > 0 || !match.rule.emptyMeansCwd
      ? match.words
      : [{ value: ".", dynamic: false, expands: false, glob: false }];
  return words.map((word): TargetVerdict => {
    if (word.expands) return { kind: "unknown", word: word.value };
    const split = word.glob ? globBase(word.value) : undefined;
    const absolute = resolve(base, split?.base ?? word.value);
    const path = insideOf(root, absolute);
    if (path === undefined) return { kind: "outside", path: absolute };
    if (match.rule.deletesGitDir && coversGitDir(path, split?.rest))
      return { kind: "git-dir", path };
    return { kind: "inside", path, glob: word.glob };
  });
}
