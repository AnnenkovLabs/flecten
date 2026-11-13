import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const timeoutMs = 30_000;

function findExecutable() {
  const candidates = [
    join(root, "release/linux-unpacked/flecten"),
    join(root, "release/linux-arm64-unpacked/flecten"),
    join(root, "release/mac/Flecten.app/Contents/MacOS/Flecten"),
    join(root, "release/mac-arm64/Flecten.app/Contents/MacOS/Flecten"),
    join(root, "release/win-unpacked/Flecten.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`packaged app not found; looked in:\n${candidates.join("\n")}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

const workdir = mkdtempSync(join(tmpdir(), "liquid-smoke-"));
const out = join(workdir, "status.json");
const executable = process.env.FLECTEN_SMOKE_EXECUTABLE
  ? resolve(process.env.FLECTEN_SMOKE_EXECUTABLE)
  : findExecutable();
const config = {
  useDefaults: false,
  provider: "smoke",
  model: "smoke-model",
  providers: {
    smoke: {
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:9/v1",
      name: "Smoke",
      models: {
        "smoke-model": {
          name: "Smoke",
          context: 8192,
          output: 1024,
          tools: true,
        },
      },
    },
  },
};

writeFileSync(join(workdir, "flecten.config.json"), `${JSON.stringify(config, null, 2)}\n`);

const env = {
  ...process.env,
  FLECTEN_SMOKE: "1",
  FLECTEN_SMOKE_OUT: out,
  FLECTEN_CWD: workdir,
  FLECTEN_CONFIG: join(workdir, "flecten.config.json"),
};
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const useXvfb = process.platform === "linux" && !process.env.DISPLAY;
const command = useXvfb ? "xvfb-run" : executable;
const commandArgs = useXvfb ? ["-a", executable, ...args] : args;
try {
  await run(command, commandArgs, { env });
  if (!existsSync(out)) throw new Error("smoke did not write status");
  const status = JSON.parse(readFileSync(out, "utf8"));
  if (status.type !== "status") throw new Error(`unexpected smoke event: ${status.type}`);
  if (!status.cwd || resolve(status.cwd) !== resolve(workdir)) {
    throw new Error(`unexpected cwd: ${status.cwd}`);
  }
  if (!Array.isArray(status.providers) || status.providers.length === 0) {
    throw new Error("status has no providers");
  }
  console.log(`packaged smoke ok: ${status.provider}/${status.model}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
