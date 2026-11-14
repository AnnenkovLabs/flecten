import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { classifyTargets, findDestructive } from "../../src/security/destructive";
import { isAssignment, parseShell, programName } from "../../src/security/shell-lexer";

const argv = (line: string) =>
  parseShell(line).commands.map((command) => command.argv.map((word) => word.value));

describe("shell lexer", () => {
  test("splits lists, pipelines and subshells into simple commands", () => {
    expect(argv("a 1 && b 2 || c; d | e & (f g)")).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c"],
      ["d"],
      ["e"],
      ["f", "g"],
    ]);
  });

  test("removes quotes and keeps operators inside quotes as text", () => {
    expect(argv(`echo "a && b" 'c; d' e\\ f`)).toEqual([["echo", "a && b", "c; d", "e f"]]);
  });

  test("finds commands nested in substitutions and sh -c strings", () => {
    const names = argv('echo $(rm -rf build) `ls` && bash -c "git clean -fd"').map(
      (words) => words[0],
    );
    expect(names).toEqual(expect.arrayContaining(["echo", "rm", "ls", "bash", "git"]));
  });

  test("marks expansions, globs and open quotes", () => {
    const [command] = parseShell('rm $HOME/x *.log "lit*"').commands;
    const flags = command?.argv.slice(1).map((word) => [word.expands, word.glob]);
    expect(flags).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(parseShell('echo "open').complete).toBe(false);
  });

  test("separates assignments and redirects from argv", () => {
    const [command] = parseShell("FOO=1 BAR=2 make all > out.txt 2>&1").commands;
    expect(command?.assignments).toEqual(["FOO=1", "BAR=2"]);
    expect(command?.argv.map((word) => word.value)).toEqual(["make", "all"]);
    expect(command?.redirects.map((redirect) => redirect.op)).toEqual([">", ">&"]);
    expect(isAssignment("A_1=x")).toBe(true);
    expect(isAssignment("=x")).toBe(false);
  });

  test("normalizes program names", () => {
    expect(programName("/usr/bin/RM")).toBe("rm");
    expect(programName("C:\\Tools\\git.exe")).toBe("git");
  });
});

describe("destructive commands", () => {
  const ids = (line: string) => findDestructive(line).map((match) => match.rule.id);

  test("reads argv, not text", () => {
    expect(ids("rm build.log")).toEqual(["rm-files"]);
    expect(ids("rm -rf build")).toEqual(["rm-files", "rm-recursive"]);
    expect(ids("rm -r -f build")).toEqual(["rm-files", "rm-recursive"]);
    expect(ids('echo "rm -rf /"')).toEqual([]);
    expect(ids("grep -r 'git reset --hard' docs")).toEqual([]);
  });

  test("finds git, cloud and publish operations by subcommand and flag", () => {
    expect(ids("git reset --hard HEAD~1")).toEqual(["git-reset-hard"]);
    expect(ids("git reset --soft HEAD~1")).toEqual([]);
    expect(ids("git push --force origin main")).toEqual(["git-push-force"]);
    expect(ids("git push origin main")).toEqual([]);
    expect(ids("git stash drop")).toEqual(["git-stash-drop"]);
    expect(ids("terraform destroy -auto-approve")).toContain("terraform-destroy");
    expect(ids("npm publish")).toContain("npm-publish");
  });

  test("looks inside wrappers and substitutions", () => {
    expect(ids('sh -c "rm -rf dist"')).toEqual(["rm-files", "rm-recursive"]);
    expect(ids("echo $(git clean -fdx)")).toEqual(
      expect.arrayContaining(["git-clean", "git-clean-ignored"]),
    );
  });

  test("classifies targets relative to the workspace", () => {
    const root = "/work/repo";
    const verdicts = (line: string, cwd = root) =>
      findDestructive(line)
        .filter((match) => match.rule.id === "rm-recursive")
        .flatMap((match) => classifyTargets(match, cwd, root));
    expect(verdicts("rm -rf build")).toEqual([{ kind: "inside", path: "build", glob: false }]);
    expect(verdicts("rm -rf ../other")).toEqual([
      { kind: "outside", path: resolve(root, "../other") },
    ]);
    expect(verdicts("rm -rf $TARGET")).toEqual([{ kind: "unknown", word: "$TARGET" }]);
    expect(verdicts("rm -rf .git")).toEqual([{ kind: "git-dir", path: ".git" }]);
    expect(verdicts("rm -rf .*")).toEqual([{ kind: "git-dir", path: "." }]);
    expect(verdicts("rm -rf src/*.tmp")).toEqual([{ kind: "inside", path: "src", glob: true }]);
  });

  test("a hard reset acts on the tree of the directory it runs in", () => {
    const [match] = findDestructive("git -C sub reset --hard");
    expect(match && classifyTargets(match, "/work/repo", "/work/repo")).toEqual([
      { kind: "inside", path: "sub", glob: false },
    ]);
  });
});
