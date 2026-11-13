import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { createServer } from "vite";

const server = await createServer();
await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  await server.close();
  throw new Error("Vite did not report a local URL");
}

const main = fileURLToPath(new URL("../shell/main.mjs", import.meta.url));
const env = { ...process.env, FLECTEN_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [main], {
  stdio: "inherit",
  env,
});

let closing = false;

async function shutdown(code) {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(code);
}

child.on("exit", (code) => {
  shutdown(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
    shutdown(0);
  });
}
