// Shared fixtures for hook tests: temp dirs, HTTP servers, hook definitions and a session with hooks.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_NAMES } from "../../shared/hooks";
import { createHookRunner } from "../../src/core/hooks/runner";
import type {
  CanonicalHookMatcher,
  HookDefinition,
  HookInput,
  HookName,
  HookRunnerOptions,
  HooksConfig,
} from "../../src/core/hooks/types";
import { createSession } from "../../src/core/session/session";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { Tool } from "../../src/tools/types";
import type { scriptedProvider } from "./fake-provider";

export const dirs: string[] = [];
export const servers: Array<ReturnType<typeof Bun.serve>> = [];
export const previousLog = process.env.FLECTEN_HOOK_LOG;
export const previousMark = process.env.FLECTEN_HOOK_MARK;
export const live = new AbortController().signal;
export const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-hooks-"));
  dirs.push(dir);
  return dir;
}

export function emptyHooks(): HooksConfig {
  return Object.fromEntries(HOOK_NAMES.map((name) => [name, []])) as HooksConfig;
}

export function hook(
  action?: string,
  matcher: string | CanonicalHookMatcher = "*",
  timeoutMs = 5000,
): HookDefinition {
  const script = join(import.meta.dir, "..", "fixtures", "hook.ts");
  return {
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}${action ? ` ${action}` : ""}`,
    envAllowlist: ["PATH", "HOME", "FLECTEN_HOOK_LOG", "FLECTEN_HOOK_MARK"],
    matcher,
    timeoutMs,
    enabled: true,
  };
}

export function httpHook(url: string, overrides: Partial<HookDefinition> = {}): HookDefinition {
  return { type: "http", url, matcher: "*", timeoutMs: 5000, enabled: true, ...overrides };
}

/** Hooks for the given events; `failClosed` marks every hook the way the config does. */
export function hooksWith(
  events: Partial<Record<HookName, HookDefinition[]>>,
  failClosed = false,
): HooksConfig {
  const marked = Object.fromEntries(
    Object.entries(events).map(([name, hooks]) => [
      name,
      failClosed ? hooks.map((entry) => ({ ...entry, failClosed: true })) : hooks,
    ]),
  );
  return { ...emptyHooks(), ...marked };
}

export function runner(config: HooksConfig, options: HookRunnerOptions = {}) {
  return createHookRunner(config, options);
}

export async function run(
  config: HooksConfig,
  event: HookName,
  input: Omit<HookInput, "sessionId" | "cwd"> & { cwd: string },
  options: HookRunnerOptions = {},
) {
  return runner(config, options).run(event, { sessionId: "s_test", ...input }, live);
}

export function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return server.url.toString();
}

export function endpoint(base: string, path: string): string {
  return new URL(path, base).toString();
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(25);
  }
  throw new Error("condition not met before timeout");
}

export function buildSession(
  provider: ReturnType<typeof scriptedProvider>,
  cwd: string,
  hooks: HooksConfig,
  toolList: Tool[] = builtinTools(),
) {
  return createSession({
    cwd,
    provider,
    providerId: "scripted",
    model: "scripted-1",
    tools: new ToolRegistry(toolList, { limits }),
    system: "test system",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 8, continuations: 0, parallelTools: true },
    hooks,
    logDir: (sessionId) => join(cwd, ".liquid/sessions", sessionId, "logs"),
  });
}

export async function loggedEvents(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { event: string }).event);
}

export async function cleanupHooks(): Promise<void> {
  if (previousLog === undefined) delete process.env.FLECTEN_HOOK_LOG;
  else process.env.FLECTEN_HOOK_LOG = previousLog;
  if (previousMark === undefined) delete process.env.FLECTEN_HOOK_MARK;
  else process.env.FLECTEN_HOOK_MARK = previousMark;
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
