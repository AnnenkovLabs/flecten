#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { configPath as projectConfigPath } from "../src/config/load.ts";
import { buildDiagnosticsBundle } from "../src/observability/diagnostics.ts";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === undefined || value.startsWith("--") ? fallback : value;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

async function readRecentErrors(path) {
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-20)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
}

function gitCommit(cwd) {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "unknown";
  return result.stdout.toString().trim() || "unknown";
}

const cwd = process.cwd();
const now = new Date();
const defaultOut = join(cwd, ".liquid", "diagnostics", now.toISOString().replace(/[:.]/g, "-"));
const output = resolve(argument("out", defaultOut));
const format = argument("format", "directory");
if (format !== "directory" && format !== "tar") {
  console.error("usage: bun scripts/diagnostics.mjs [--out path] [--format directory|tar]");
  process.exit(2);
}

const packageJson = await readJson(join(cwd, "package.json"));
const configPath = resolve(argument("config", projectConfigPath(cwd)));
const config = existsSync(configPath) ? await readJson(configPath) : {};
const configObject = config && typeof config === "object" && !Array.isArray(config) ? config : {};
const source = configObject.providers;
const providers =
  source && typeof source === "object" && !Array.isArray(source)
    ? Object.entries(source)
        .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
        .map(([name, value]) => ({ name, ...value }))
    : [];

const bundle = buildDiagnosticsBundle({
  version: typeof packageJson.version === "string" ? packageJson.version : "unknown",
  commit: gitCommit(cwd),
  paths: {
    workingDirectory: cwd,
    config: configPath,
    sessions: join(cwd, ".liquid", "sessions"),
    logs: join(cwd, ".liquid", "logs"),
    diagnostics: join(cwd, ".liquid", "diagnostics"),
  },
  providers,
  recentErrors: await readRecentErrors(join(cwd, ".liquid", "diagnostics", "recent-errors.jsonl")),
  config: configObject,
  now,
  platform: process.platform,
});

async function writeBundle(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "diagnostics.json"),
    `${JSON.stringify(bundle, null, 2)}\n`,
    "utf8",
  );
}

if (format === "directory") {
  await writeBundle(output);
  console.log(join(output, "diagnostics.json"));
} else {
  const temporary = await mkdtemp(join(tmpdir(), "liquid-diagnostics-"));
  try {
    await writeBundle(temporary);
    await mkdir(dirname(output), { recursive: true });
    const tar = Bun.spawnSync(["tar", "-cf", output, "-C", temporary, "."], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (tar.exitCode !== 0) {
      throw new Error(`tar failed: ${tar.stderr.toString().trim()}`);
    }
    console.log(output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
