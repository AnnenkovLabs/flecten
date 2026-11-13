import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import { atomicWrite } from "../util/atomic";

export type Secrets = Record<string, string>;
export type SecretBackend = "keychain" | "file";

const SERVICE = "flecten";
const LEGACY_SERVICE = "liquid-harness";
let forcedBackend: SecretBackend | undefined;
let detectedBackend: SecretBackend | undefined;

export function setSecretBackend(backend: SecretBackend | undefined): void {
  forcedBackend = backend;
  detectedBackend = undefined;
}

function hasCommand(command: string): boolean {
  try {
    return Bun.spawnSync(["which", command], { stdout: "pipe", stderr: "pipe" }).success;
  } catch {
    return false;
  }
}

export function secretBackend(): SecretBackend {
  if (forcedBackend) return forcedBackend;
  if (detectedBackend) return detectedBackend;
  if (productEnv("SECRET_BACKEND") === "file") {
    detectedBackend = "file";
  } else if (productEnv("SECRET_BACKEND") === "keychain") {
    detectedBackend = "keychain";
  } else if (process.platform === "linux" && hasCommand("secret-tool")) {
    detectedBackend = "keychain";
  } else if (process.platform === "darwin" && hasCommand("security")) {
    detectedBackend = "keychain";
  } else {
    detectedBackend = "file";
  }
  return detectedBackend;
}

export function secretsPath(cwd: string): string {
  return join(cwd, ".liquid", "secrets.json");
}

function account(cwd: string, name: string): string {
  let project = resolve(cwd);
  try {
    project = realpathSync(project);
  } catch {}
  return `${createHash("sha256").update(project).digest("hex")}:${name}`;
}

function keychainGet(name: string, service = SERVICE): string | undefined {
  try {
    if (process.platform === "linux") {
      const result = Bun.spawnSync(["secret-tool", "lookup", "service", service, "key", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (!result.success) return undefined;
      const value = result.stdout.toString().trim();
      return value.length > 0 ? value : undefined;
    }
    if (process.platform === "darwin") {
      const result = Bun.spawnSync(
        ["security", "find-generic-password", "-s", service, "-a", name, "-w"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (!result.success) return undefined;
      const value = result.stdout.toString().trim();
      return value.length > 0 ? value : undefined;
    }
  } catch {}
  return undefined;
}

function keychainSet(name: string, value: string): boolean {
  try {
    if (process.platform === "linux") {
      const result = Bun.spawnSync(
        ["secret-tool", "store", "--label", `Flecten ${name}`, "service", SERVICE, "key", name],
        { stdin: Buffer.from(value), stdout: "pipe", stderr: "pipe" },
      );
      return result.success;
    }
    if (process.platform === "darwin") {
      const result = Bun.spawnSync(
        ["security", "add-generic-password", "-s", SERVICE, "-a", name, "-w", value, "-U"],
        { stdout: "pipe", stderr: "pipe" },
      );
      return result.success;
    }
  } catch {}
  return false;
}

function keychainDelete(name: string, service = SERVICE): void {
  try {
    if (process.platform === "linux") {
      Bun.spawnSync(["secret-tool", "clear", "service", service, "key", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } else if (process.platform === "darwin") {
      Bun.spawnSync(["security", "delete-generic-password", "-s", service, "-a", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
    }
  } catch {}
}

export async function loadSecrets(cwd: string, names: string[] = []): Promise<Secrets> {
  const output: Secrets = {};
  try {
    const value = (await Bun.file(secretsPath(cwd)).json()) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string" && entry.length > 0) output[key] = entry;
      }
    }
  } catch {}
  if (secretBackend() === "keychain") {
    for (const name of names) {
      const key = account(cwd, name);
      const value = keychainGet(key) ?? keychainGet(key, LEGACY_SERVICE);
      if (value) output[name] = value;
    }
  }
  return output;
}

export async function saveSecrets(
  cwd: string,
  secrets: Secrets,
  options: { deletes?: string[] } = {},
): Promise<void> {
  if (secretBackend() === "keychain") {
    let ok = true;
    for (const name of options.deletes ?? []) {
      keychainDelete(account(cwd, name));
      keychainDelete(account(cwd, name), LEGACY_SERVICE);
    }
    for (const [name, value] of Object.entries(secrets)) {
      if (!keychainSet(account(cwd, name), value)) ok = false;
    }
    if (ok) {
      try {
        await unlink(secretsPath(cwd));
      } catch {}
      return;
    }
  }
  await atomicWrite(secretsPath(cwd), `${JSON.stringify(secrets, null, 2)}\n`, 0o600);
}
