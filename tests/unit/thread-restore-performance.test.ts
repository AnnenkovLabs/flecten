import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileModule } from "svelte/compiler";

test("large chat restoration stays responsive and preserves client updates", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "flecten-thread-client-"));
  try {
    // SSR runes have no proxies and conceal the repeated scans that freeze the renderer.
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../helpers/thread-restore-client.svelte.ts")],
      outdir,
      target: "bun",
      conditions: ["browser"],
      plugins: [
        {
          name: "thread-client-runes",
          setup(builder) {
            builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => ({
              contents: compileModule(
                new Bun.Transpiler({ loader: "ts" }).transformSync(await Bun.file(path).text()),
                { filename: path, generate: "client", dev: false },
              ).js.code,
              loader: "js",
            }));
          },
        },
      ],
    });
    if (!result.success) throw new AggregateError(result.logs);
    const { verifyThreadRestore } = await import(join(outdir, "thread-restore-client.svelte.js"));
    verifyThreadRestore();
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
