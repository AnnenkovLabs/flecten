import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalStreamEvent } from "../../shared/terminal";
import { IdeTerminal } from "../../src/app/ide-terminal";
import { TerminalManager } from "../../src/terminal/manager";
import {
  buildInteractiveEnvironment,
  detectDefaultUserShell,
  listShellProfiles,
} from "../../src/terminal/profiles";
import { runTerminal } from "../../src/tools/terminal/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const hubs: IdeTerminal[] = [];
const managers: TerminalManager[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.dispose()));
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "flecten-term-hub-"));
  dirs.push(dir);
  return dir;
}

async function waitForOutput(
  events: TerminalStreamEvent[],
  tabId: string,
  needle: string,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const joined = events
      .filter(
        (event): event is Extract<TerminalStreamEvent, { type: "terminal.data" }> =>
          event.type === "terminal.data" && event.id === tabId,
      )
      .map((event) => event.data)
      .join("");
    if (joined.includes(needle)) return joined;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for ${needle} in tab ${tabId}`);
}

describe("native shell profiles", () => {
  test("detects user shell and filters internal runtime variables from interactive env", () => {
    const shell = detectDefaultUserShell();
    expect(shell.length).toBeGreaterThan(0);

    const profiles = listShellProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.some((profile) => profile.isDefault)).toBe(true);

    const env = buildInteractiveEnvironment(
      "/tmp/project",
      "/bin/zsh",
      { CUSTOM_USER_VAR: "ok" },
      {
        PATH: "/usr/bin:/bin",
        HOME: "/home/tester",
        FLECTEN_PROFILE: "/secret/profile",
        ELECTRON_RUN_AS_NODE: "1",
        NO_COLOR: "1",
        SSH_AUTH_SOCK: "/tmp/ssh.sock",
      },
      "linux",
    );
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.TERM_PROGRAM).toBe("Flecten");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
    expect(env.CUSTOM_USER_VAR).toBe("ok");
    expect(env.FLECTEN_PROFILE).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NO_COLOR).toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("IdeTerminal multi-tab hub", () => {
  test("creates multiple native interactive tabs with real job control and push streaming", async () => {
    const cwd = await tempDir();
    const hub = new IdeTerminal(cwd, () => ({ shell: Bun.which("bash") ?? "/bin/bash" }));
    hubs.push(hub);

    const events: TerminalStreamEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const first = await hub.command({ action: "create", cols: 110, rows: 30, title: "Main shell" });
    const second = await hub.command({ action: "create", cols: 90, rows: 24, title: "Logs" });
    expect(first.tab?.owner).toBe("user");
    expect(first.tab?.title).toBe("Main shell");
    expect(second.tab?.title).toBe("Logs");
    expect(hub.tabs().map((tab) => tab.title)).toEqual(["Main shell", "Logs"]);

    const firstId = first.tab?.id;
    const secondId = second.tab?.id;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    if (!firstId || !secondId) throw new Error("expected created tab ids");
    // Test real native Ctrl+C job control: interrupt foreground sleep without killing the shell.
    await hub.command({ action: "write", id: firstId, data: "sleep 10\r" });
    await Bun.sleep(150);
    await hub.command({ action: "write", id: firstId, data: "\x03" });
    await Bun.sleep(150);
    await hub.command({ action: "write", id: firstId, data: "echo CTRL_C_ALIVE\r" });

    const output = await waitForOutput(events, firstId, "CTRL_C_ALIVE");
    expect(output).toContain("CTRL_C_ALIVE");
    expect(output).not.toContain("no job control");

    await hub.command({ action: "rename", id: firstId, title: "Dev shell" });
    expect(hub.tabs().find((tab) => tab.id === firstId)?.title).toBe("Dev shell");

    await hub.command({ action: "close", id: secondId });
    expect(hub.tabs().map((tab) => tab.id)).toEqual([firstId]);
  }, 15_000);

  test("mirrors agent PTY tabs into the shared hub and allows human interactive write and close", async () => {
    const cwd = await tempDir();
    const hub = new IdeTerminal(cwd, () => ({}));
    hubs.push(hub);
    const manager = new TerminalManager();
    managers.push(manager);

    const events: TerminalStreamEvent[] = [];
    hub.subscribe((event) => events.push(event));
    manager.onEvent((event) => {
      if (event.type === "session.created") {
        hub.attachAgentLifecycle({
          kind: "created",
          sessionId: "s-agent",
          role: "worker",
          id: event.session.id,
          ...(event.title ? { title: event.title } : {}),
          session: event.session,
          close: () => manager.close(event.session.id),
        });
      } else if (event.type === "session.closed") {
        hub.attachAgentLifecycle({
          kind: "closed",
          sessionId: "s-agent",
          role: "worker",
          id: event.id,
        });
      }
    });

    const ctx: ToolContext = {
      sessionId: "s-agent",
      cwd,
      signal: new AbortController().signal,
      logDir: join(cwd, ".flecten", "logs"),
      limits: {
        maxOutputBytes: 50_000,
        maxOutputLines: 2000,
        bashTimeoutMs: 10_000,
        readLimitLines: 2000,
      },
      reads: new ReadTracker(),
      terminals: manager,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "C.UTF-8" },
    };

    const userTab = await hub.command({ action: "create", title: "My shell" });
    const agentRun = await runTerminal(
      { op: "run", id: "server", title: "Dev Server", command: "cat", timeoutMs: 250 },
      ctx,
    );
    expect(agentRun.ok).toBe(true);

    const tabs = hub.tabs();
    expect(tabs.some((tab) => tab.owner === "user" && tab.id === userTab.tab?.id)).toBe(true);
    const agentTab = tabs.find((tab) => tab.owner === "agent" && tab.ptyId === "server");
    expect(agentTab).toBeDefined();
    if (!agentTab) throw new Error("expected mirrored agent tab");
    expect(agentTab.title).toBe("Dev Server");
    expect(agentTab.role).toBe("worker");

    // Human writes directly into the live agent PTY tab.
    await hub.command({ action: "write", id: agentTab.id, data: "HUMAN_TAKEOVER_OK\n" });
    const streamed = await waitForOutput(events, agentTab.id, "HUMAN_TAKEOVER_OK");
    expect(streamed).toContain("HUMAN_TAKEOVER_OK");

    // Closing the agent tab from the UI closes it in the agent's TerminalManager too.
    await hub.command({ action: "close", id: agentTab.id });
    expect(manager.get("server")).toBeUndefined();
    expect(hub.tabs().some((tab) => tab.id === agentTab.id)).toBe(false);
  }, 15_000);
});
