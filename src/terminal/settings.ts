export interface TerminalTimeouts {
  /** Default wait of a foreground `terminal run` for its completion marker. */
  commandMs: number;
  sessionMs: number | null;
  jobWaitMs: number;
  jobMs: number | null;
}

export interface TerminalBackgroundSettings {
  defaultPersistent: boolean;
  maxLogBytes: number;
}

export interface TerminalPortRange {
  min: number;
  max: number;
}

export interface TerminalResourceLimits {
  maxProcesses: number;
  maxMemoryBytes: number;
  ports: TerminalPortRange | null;
}

export interface TerminalSettings {
  shell: string;
  envAllowlist: string[];
  scrollback: number;
  timeouts: TerminalTimeouts;
  ansi: boolean;
  notifications: boolean;
  background: TerminalBackgroundSettings;
  limits: TerminalResourceLimits;
}

export interface TerminalSettingsInput {
  shell?: string;
  envAllowlist?: string[];
  scrollback?: number;
  timeouts?: Partial<TerminalTimeouts>;
  ansi?: boolean;
  notifications?: boolean;
  background?: Partial<TerminalBackgroundSettings>;
  limits?: Omit<Partial<TerminalResourceLimits>, "ports"> & {
    ports?: TerminalPortRange | null;
  };
}

const ENV_ALLOWLIST = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "PWD"];

export function defaultTerminalEnvAllowlist(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32"
    ? [...ENV_ALLOWLIST, "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE"]
    : [...ENV_ALLOWLIST];
}

export function defaultTerminalShell(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "cmd.exe" : "/bin/bash";
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  shell: defaultTerminalShell(),
  envAllowlist: defaultTerminalEnvAllowlist(),
  scrollback: 1000,
  timeouts: {
    commandMs: 120_000,
    sessionMs: null,
    jobWaitMs: 30_000,
    jobMs: null,
  },
  ansi: true,
  notifications: true,
  background: {
    defaultPersistent: false,
    maxLogBytes: 1024 * 1024,
  },
  limits: {
    maxProcesses: 64,
    maxMemoryBytes: 4 * 1024 * 1024 * 1024,
    ports: { min: 1024, max: 65535 },
  },
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(value: number | null, name: string): number | null {
  return value === null ? null : positiveInteger(value, name);
}

function resolvePorts(ports: TerminalPortRange | null): TerminalPortRange | null {
  if (ports === null) return null;
  const min = positiveInteger(ports.min, "limits.ports.min");
  const max = positiveInteger(ports.max, "limits.ports.max");
  if (min > 65535 || max > 65535) {
    throw new RangeError("limits.ports must stay within 1..65535");
  }
  if (min > max) throw new RangeError("limits.ports.min must not exceed limits.ports.max");
  return { min, max };
}

export function resolveTerminalSettings(input: TerminalSettingsInput = {}): TerminalSettings {
  const defaults = DEFAULT_TERMINAL_SETTINGS;
  const shell = input.shell ?? defaults.shell;
  if (shell.trim().length === 0) throw new RangeError("shell must not be empty");
  const envAllowlist = input.envAllowlist ?? defaults.envAllowlist;
  const limits = input.limits ?? {};
  const ports = limits.ports === undefined ? defaults.limits.ports : resolvePorts(limits.ports);
  return {
    shell,
    envAllowlist: envAllowlist.filter((key) => key.length > 0),
    scrollback: positiveInteger(input.scrollback ?? defaults.scrollback, "scrollback"),
    timeouts: {
      commandMs: positiveInteger(
        input.timeouts?.commandMs ?? defaults.timeouts.commandMs,
        "timeouts.commandMs",
      ),
      sessionMs: optionalPositiveInteger(
        input.timeouts?.sessionMs === undefined
          ? defaults.timeouts.sessionMs
          : input.timeouts.sessionMs,
        "timeouts.sessionMs",
      ),
      jobWaitMs: positiveInteger(
        input.timeouts?.jobWaitMs ?? defaults.timeouts.jobWaitMs,
        "timeouts.jobWaitMs",
      ),
      jobMs: optionalPositiveInteger(
        input.timeouts?.jobMs === undefined ? defaults.timeouts.jobMs : input.timeouts.jobMs,
        "timeouts.jobMs",
      ),
    },
    ansi: input.ansi ?? defaults.ansi,
    notifications: input.notifications ?? defaults.notifications,
    background: {
      defaultPersistent:
        input.background?.defaultPersistent ?? defaults.background.defaultPersistent,
      maxLogBytes: positiveInteger(
        input.background?.maxLogBytes ?? defaults.background.maxLogBytes,
        "background.maxLogBytes",
      ),
    },
    limits: {
      maxProcesses: positiveInteger(
        limits.maxProcesses ?? defaults.limits.maxProcesses,
        "limits.maxProcesses",
      ),
      maxMemoryBytes: positiveInteger(
        limits.maxMemoryBytes ?? defaults.limits.maxMemoryBytes,
        "limits.maxMemoryBytes",
      ),
      ports,
    },
  };
}
