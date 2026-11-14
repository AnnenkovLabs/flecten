import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type ElectronApplication, _electron as electron, type Page } from "@playwright/test";
import type { ModulesConfig } from "../../src/config/modules";
import type { ModelInfo } from "../../ui/src/lib/types";

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, "../..");
export const README_MARKER = "E2E_README_MARKER: liquid harness read tool";

const shellMain = join(repoRoot, "shell/main.mjs");
const uiIndex = join(repoRoot, "ui/dist/index.html");
const mockScript = join(repoRoot, "scripts/e2e-mock.mjs");

export interface AppHarness {
  app: ElectronApplication;
  page: Page;
  cwd: string;
  consoleErrors: string[];
  releaseSummary(): Promise<void>;
  close(): Promise<void>;
}

interface MockProvider {
  url: string;
  releaseSummary(): Promise<void>;
  stop(): Promise<void>;
}

function electronExecutable(): string | undefined {
  try {
    const resolved: unknown = createRequire(import.meta.url)("electron");
    return typeof resolved === "string" && existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function commandExists(command: string): boolean {
  return spawnSync(command, ["--help"], { stdio: "ignore" }).error === undefined;
}

export function environmentProblem(): string | undefined {
  if (!existsSync(shellMain)) return `Electron entry point not found: ${shellMain}`;
  if (!existsSync(uiIndex)) return 'ui/dist is missing. Run "bun run build:ui" first.';
  if (!electronExecutable()) return 'Electron is not installed. Run "bun install" first.';
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (!commandExists("xvfb-run")) {
      return "Linux headless: DISPLAY is not set and xvfb-run is missing. Install xvfb or run with a desktop session.";
    }
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function startMockProvider(
  delayMs: number,
  chunkMs: number,
  summaryPauseMs: number,
  reply: string | undefined,
  holdSummary: boolean,
  calls?: Array<{ name: string; arguments: Record<string, unknown> }>,
  usage?: LaunchOptions["usage"],
  twinLearning = false,
): Promise<MockProvider> {
  const child = spawn("bun", [mockScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      E2E_MOCK_PORT: "0",
      E2E_MOCK_DELAY_MS: String(delayMs),
      E2E_MOCK_CHUNK_MS: String(chunkMs),
      E2E_MOCK_SUMMARY_PAUSE_MS: String(summaryPauseMs),
      E2E_MOCK_HOLD_SUMMARY: holdSummary ? "1" : "0",
      E2E_MOCK_TWIN_LEARNING: twinLearning ? "1" : "0",
      ...(calls ? { E2E_MOCK_CALLS: JSON.stringify(calls) } : {}),
      ...(usage ? { E2E_MOCK_USAGE: JSON.stringify(usage) } : {}),
      ...(reply === undefined ? {} : { E2E_MOCK_REPLY: reply }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.stdout || !child.stderr) {
    child.kill("SIGKILL");
    throw new Error("mock provider failed to start: missing stdio pipes");
  }

  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const lines = createInterface({ input: child.stdout });
  let port: number;
  try {
    port = await new Promise<number>((resolvePort, rejectPort) => {
      const timer = setTimeout(() => {
        rejectPort(new Error("mock provider did not report a port within 10s"));
      }, 10_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectPort(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        rejectPort(new Error(`mock provider exited before reporting a port (code ${code})`));
      });
      lines.on("line", (line) => {
        try {
          const parsed = JSON.parse(line) as { port?: unknown };
          if (typeof parsed.port === "number") {
            clearTimeout(timer);
            resolvePort(parsed.port);
          }
        } catch {
          // Human-readable startup lines are ignored.
        }
      });
    });
  } catch (error) {
    lines.close();
    child.kill("SIGKILL");
    throw error;
  }

  return {
    url: `http://127.0.0.1:${port}/v1`,
    async releaseSummary() {
      const response = await fetch(`http://127.0.0.1:${port}/control/summary/continue`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`Cannot release summary: ${response.status}`);
    },
    async stop() {
      lines.close();
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

function configFor(
  baseUrl: string,
  models?: Record<string, ModelInfo>,
  modules?: LaunchOptions["modules"],
  conversation: LaunchOptions["conversation"] = false,
): unknown {
  return {
    useDefaults: false,
    provider: "e2e",
    model: "e2e-model",
    providers: {
      e2e: {
        name: "E2E Mock",
        protocol: "openai-chat",
        baseUrl,
        models: models ?? {
          "e2e-model": {
            name: "E2E Mock",
            context: 32768,
            output: 4096,
            tools: true,
            reasoning: false,
          },
        },
      },
    },
    permissions: {
      read: "auto",
      write: "auto",
      shell: conversation === false ? "auto" : "allow",
      network: "auto",
      mcp: "auto",
      skill: "allow",
      externalPath: "deny",
      rules: [],
    },
    sandbox: { enabled: false },
    ...(conversation === null ? {} : { conversation: { enabled: conversation } }),
    ...(modules ? { modules } : {}),
    catalog: { autoRefresh: false, ttlMs: 43_200_000 },
  };
}

function attachConsoleErrors(page: Page, errors: string[]): void {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`[console] ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[pageerror] ${error.message}`));
}

function launchEnvironment(cwd: string, configPath: string, user?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FLECTEN_CWD = cwd;
  env.FLECTEN_CONFIG = configPath;
  env.FLECTEN_HEADLESS = "1";
  if (user) {
    env.USER = user;
    env.USERNAME = user;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FLECTEN_DEV_URL;
  delete env.FLECTEN_DEVTOOLS;
  delete env.FLECTEN_PROVIDER;
  delete env.FLECTEN_MODEL;
  delete env.FLECTEN_AGENT_BIN;
  delete env.FLECTEN_SMOKE;
  delete env.FLECTEN_SMOKE_OUT;
  delete env.FLECTEN_SHOT_PROMPT;
  delete env.FLECTEN_SHOT_EXPAND;
  delete env.FLECTEN_SHOT_TOOL;
  delete env.FLECTEN_SHOT_SETTINGS;
  return env;
}

export interface LaunchOptions {
  /** Exercise the normal desktop profile instead of an explicitly selected config file. */
  appProfile?: boolean;
  /** null leaves the product default; other E2E paths explicitly exercise a single agent. */
  conversation?: boolean | null;
  /** null leaves fresh storage untouched, proving the product default. */
  locale?: "en" | "zh-Hans" | "pt-BR" | "es" | "ja" | "uk" | "ru" | null;
  usage?: { input: number; output: number; cached: number; reasoning: number };
  firstCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Chromium synthesizes a microphone; tests never capture the user's real mic. */
  fakeMicrophone?: boolean;
  fakeMicrophoneFile?: string;
  voiceHome?: string;
  models?: Record<string, ModelInfo>;
  /** Existing modules must be present at startup to exercise the project trust gate. */
  modules?: Pick<ModulesConfig, "dirs" | "trusted">;
  delayMs?: number;
  chunkMs?: number;
  summaryPauseMs?: number;
  /** Keep the streamed completion open until the test has observed its pending UI. */
  holdSummary?: boolean;
  /** Hold a valid Twin extraction until releaseSummary, so real training remains observable. */
  twinLearning?: boolean;
  /** Final answer of the mock model instead of the README summary. */
  reply?: string;
  directory?: string;
  /** Project of another window that is still open: used as is, never cleared or removed. */
  cwd?: string;
  user?: string;
  /** Isolated Chromium profile, reusable across restarts in a persistence test. */
  userData?: string;
}

function prepareDirectory(options: LaunchOptions): string {
  if (options.cwd) return options.cwd;
  if (!options.directory) return mkdtempSync(join(tmpdir(), "liquid-e2e-"));
  const cwd = join(tmpdir(), options.directory);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppHarness> {
  const cwd = prepareDirectory(options);
  const owned = options.cwd === undefined;
  const removeOwned = (): void => {
    if (owned) rmSync(cwd, { recursive: true, force: true });
  };
  const consoleErrors: string[] = [];
  let mock: MockProvider | undefined;
  let app: ElectronApplication | undefined;

  try {
    mock = await startMockProvider(
      options.delayMs ?? 0,
      options.chunkMs ?? 0,
      options.summaryPauseMs ?? 0,
      options.reply,
      options.holdSummary ?? false,
      options.firstCalls,
      options.usage,
      options.twinLearning,
    );
    const configPath = join(cwd, "flecten.config.json");
    if (owned) {
      writeFileSync(join(cwd, "README.md"), `# Flecten E2E\n\n${README_MARKER}\n`);
      writeFileSync(
        configPath,
        `${JSON.stringify(configFor(mock.url, options.models, options.modules, options.conversation), null, 2)}\n`,
      );
    }

    const executable = electronExecutable();
    if (!executable) throw new Error('Electron is not installed. Run "bun install" first.');

    let executablePath = executable;
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      const wrapper = join(cwd, owned ? "xvfb-electron.sh" : "xvfb-electron-2.sh");
      writeFileSync(wrapper, `#!/bin/sh\nexec xvfb-run -a ${shellQuote(executable)} "$@"\n`, {
        mode: 0o755,
      });
      executablePath = wrapper;
    }

    let entryPoint = shellMain;
    const userData =
      options.userData ?? (options.appProfile ? join(cwd, "app-profile") : undefined);
    if (userData) {
      mkdirSync(userData, { recursive: true });
      entryPoint = join(cwd, "e2e-profile.cjs");
      writeFileSync(
        entryPoint,
        [
          'const { app } = require("electron");',
          `app.setPath("appData", ${JSON.stringify(dirname(userData))});`,
          `app.setPath("userData", ${JSON.stringify(userData)});`,
          `import(${JSON.stringify(pathToFileURL(shellMain).href)});`,
        ].join("\n"),
      );
    }

    const env = launchEnvironment(cwd, configPath, options.user);
    if (options.appProfile) {
      delete env.FLECTEN_CONFIG;
      env.FLECTEN_SECRET_BACKEND = "file";
    }
    app = await electron.launch({
      executablePath,
      args: [
        entryPoint,
        ...(options.fakeMicrophone
          ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
          : []),
        ...(options.fakeMicrophoneFile
          ? [`--use-file-for-fake-audio-capture=${options.fakeMicrophoneFile}`]
          : []),
      ],
      cwd: repoRoot,
      env: {
        ...env,
        FLECTEN_VOICE_HOME: options.voiceHome ?? join(cwd, ".voice-cache"),
      },
      timeout: 30_000,
    });

    const tracked = new WeakSet<Page>();
    const track = (page: Page): void => {
      if (tracked.has(page)) return;
      tracked.add(page);
      attachConsoleErrors(page, consoleErrors);
    };
    for (const existing of app.windows()) track(existing);
    app.on("window", track);

    const page = app.windows()[0] ?? (await app.firstWindow());
    await page.waitForLoadState("domcontentloaded");
    if (options.locale !== null) {
      await page.evaluate(
        (locale) => localStorage.setItem("flecten.locale", locale),
        options.locale ?? "ru",
      );
      await page.reload();
    }

    const readyApp = app;
    const readyMock = mock;
    return {
      app: readyApp,
      page,
      cwd,
      consoleErrors,
      releaseSummary: () => readyMock.releaseSummary(),
      async close() {
        try {
          await readyApp.close();
        } catch {
          await readyApp
            .evaluate(({ app: electronApp }) => electronApp.quit())
            .catch(() => undefined);
        }
        await readyMock.stop();
        removeOwned();
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await mock?.stop();
    removeOwned();
    throw error;
  }
}

export type { ElectronApplication, Page };
