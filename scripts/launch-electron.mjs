import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const main = fileURLToPath(new URL("../shell/main.mjs", import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [main, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
