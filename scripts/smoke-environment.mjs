import { resolve } from "node:path";

export function smokeEnvironment(environment, workdir, out) {
  const env = {};
  for (const [key, value] of Object.entries(environment)) {
    if (
      !key.startsWith("FLECTEN_") &&
      !key.startsWith("LIQUID_") &&
      key !== "ELECTRON_RUN_AS_NODE"
    ) {
      env[key] = value;
    }
  }
  return {
    ...env,
    FLECTEN_SMOKE: "1",
    FLECTEN_SMOKE_OUT: out,
    FLECTEN_CWD: workdir,
    FLECTEN_CONFIG: resolve(workdir, "flecten.config.json"),
    FLECTEN_HEADLESS: "1",
  };
}

export function validateSmokeResult(result, workdir) {
  const { status, renderer, agent } = result;
  if (status?.type !== "status")
    throw new Error("smoke did not receive status through the renderer");
  if (!status.cwd || resolve(status.cwd) !== resolve(workdir))
    throw new Error(`unexpected cwd: ${status.cwd}`);
  if (!Array.isArray(status.providers) || status.providers.length === 0)
    throw new Error("status has no providers");
  if (!renderer?.ready || !renderer.preload || !renderer.composer || !renderer.model) {
    throw new Error("packaged renderer/preload/composer is not ready");
  }
  if (!agent?.packaged || !agent.command || agent.command !== agent.expected) {
    throw new Error("smoke did not use the bundled agent executable");
  }
  return status;
}
