import { cp, rm, stat } from "node:fs/promises";

export const AGENT_BINARY_PATH =
  process.platform === "win32" ? "dist/flecten-agent.exe" : "dist/flecten-agent";
// 0.1.3 / Bun 1.4.2: linux-x64 80.5 MiB, windows-x64 85.1 MiB (89,201,152 bytes).
// The larger Windows runtime gets 0.9 MiB headroom; other platforms keep their existing cap.
export function agentSizeBudget(platform: NodeJS.Platform): number {
  return (platform === "win32" ? 86 : 85) * 1024 * 1024;
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
  const build = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      "--compile",
      "--minify",
      "src/app/server.ts",
      "--outfile",
      AGENT_BINARY_PATH,
    ],
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
