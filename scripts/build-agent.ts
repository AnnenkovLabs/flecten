import { cp, rm, stat } from "node:fs/promises";

export const AGENT_BINARY_PATH =
  process.platform === "win32" ? "dist/flecten-agent.exe" : "dist/flecten-agent";
// Bun 1.4.4 compiled agents: Windows x64 113.0, Linux x64 107.2,
// macOS x64 96.7, macOS arm64 88.2 MiB. Keep roughly 2 MiB headroom on each target.
export function agentSizeBudget(platform: NodeJS.Platform, arch = process.arch): number {
  if (platform === "win32") return 115 * 1024 * 1024;
  if (platform === "darwin") return (arch === "arm64" ? 90 : 98) * 1024 * 1024;
  return 109 * 1024 * 1024;
}
export const AGENT_SIZE_BUDGET_BYTES = agentSizeBudget(process.platform);

export interface AgentSizeCheck {
  ok: boolean;
  message: string;
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function checkAgentSize(
  sizeBytes: number,
  budgetBytes = AGENT_SIZE_BUDGET_BYTES,
): AgentSizeCheck {
  const size = mib(sizeBytes);
  const budget = mib(budgetBytes);
  if (sizeBytes > budgetBytes) {
    return {
      ok: false,
      message: `agent binary is ${size} MiB, over the ${budget} MiB budget. Remove build inputs or justify raising AGENT_SIZE_BUDGET_BYTES in scripts/build-agent.ts.`,
    };
  }
  return { ok: true, message: `agent binary ${size} MiB within the ${budget} MiB budget` };
}

if (import.meta.main) {
  const buildEnv = {
    ...process.env,
    FLECTEN_BUILD_POSTHOG_API_KEY: (
      process.env.FLECTEN_POSTHOG_API_KEY ??
      process.env.POSTHOG_API_KEY ??
      ""
    ).trim(),
    FLECTEN_BUILD_POSTHOG_HOST: (
      process.env.FLECTEN_POSTHOG_HOST ??
      process.env.POSTHOG_HOST ??
      "https://eu.i.posthog.com"
    ).trim(),
    FLECTEN_BUILD_COMMIT: (process.env.FLECTEN_COMMIT ?? process.env.GITHUB_SHA ?? "")
      .trim()
      .slice(0, 12),
  };
  const build = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      "--compile",
      "--minify",
      "--env=FLECTEN_BUILD_*",
      "src/app/server.ts",
      "--outfile",
      AGENT_BINARY_PATH,
    ],
    env: buildEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!build.success) {
    process.exit(build.exitCode ?? 1);
  }

  await rm("dist/prompts", { recursive: true, force: true });
  await cp("prompts", "dist/prompts", { recursive: true });
  await rm("dist/module-marketplace", { recursive: true, force: true });
  console.log(`built ${AGENT_BINARY_PATH} with dist/prompts`);

  const size = (await stat(AGENT_BINARY_PATH)).size;
  const check = checkAgentSize(size);
  console.log(check.message);
  if (!check.ok) {
    process.exitCode = 1;
  }
}
