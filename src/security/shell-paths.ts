import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parseShell } from "./shell-lexer";
import { sshResources } from "./ssh-resources";

const SAFE_DEVICES = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/zero", "nul"]);

/** Lexical file arguments only. Expansions and subprocess effects remain OS-enforced. */
export function shellPaths(command: string, cwd: string): string[] {
  const paths = new Set<string>();
  for (const simple of parseShell(command).commands) {
    const ssh = sshResources(simple.argv);
    for (const local of ssh?.commands ?? [])
      for (const path of shellPaths(local, cwd)) paths.add(path);
    const words = [
      ...(ssh
        ? ssh.files
        : simple.argv
            .slice(1)
            .filter((word) => !word.expands && !word.glob)
            .map((word) => word.value)),
      ...simple.assignments,
      ...simple.redirects
        .filter((redirect) => !["<<", "<<<", ">&", "<&"].includes(redirect.op))
        .map((redirect) => redirect.target),
    ];
    for (const word of words) {
      const equals = word.indexOf("=");
      let path = equals >= 0 ? word.slice(equals + 1) : word;
      if (path === "~") path = homedir();
      else if (path.startsWith("~/") || path.startsWith("~\\"))
        path = resolve(homedir(), path.slice(2));
      if (
        !isAbsolute(path) &&
        !path.startsWith("../") &&
        !path.startsWith("./") &&
        !path.startsWith("..\\") &&
        !path.startsWith(".\\")
      )
        continue;
      if (!path.includes("\0") && !SAFE_DEVICES.has(path.toLowerCase()))
        paths.add(resolve(cwd, path));
    }
  }
  return [...paths];
}
