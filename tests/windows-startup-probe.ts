import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cwd = await mkdtemp(join(tmpdir(), "flecten-win-probe-"));
const config = join(cwd, "flecten.config.json");
await writeFile(config, "{}");
const proc = Bun.spawn([process.execPath, "src/app/server.ts"], {
  stdin: "pipe", stdout: "inherit", stderr: "inherit",
  env: { ...process.env, FLECTEN_CWD: cwd, FLECTEN_CONFIG: config,
    FLECTEN_SECRET_BACKEND: "file" },
});
setTimeout(() => proc.kill(), 10000);
await proc.exited;
