import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** A real Bun child exercises the configured native shell without POSIX fixture syntax. */
export async function bunCommand(cwd: string, source: string): Promise<string> {
  const path = join(cwd, `terminal-${randomUUID()}.mjs`);
  await Bun.write(path, source);
  return process.platform === "win32" ? `bun "${path}"` : `bun '${path.replaceAll("'", "'\\''")}'`;
}

export const idleSource = "setTimeout(() => {}, 30_000);";

export function childSource(options: { pidFile?: string; exit?: boolean } = {}): string {
  return `
const child = Bun.spawn([process.execPath, "-e", ${JSON.stringify(idleSource)}], {
  stdin: "ignore", stdout: "ignore", stderr: "ignore",
});
${options.pidFile ? `await Bun.write(${JSON.stringify(options.pidFile)}, String(child.pid));` : ""}
process.stdout.write("CHILD:" + child.pid + "\\n");
${options.exit ? "process.exit(0);" : idleSource}
`;
}
