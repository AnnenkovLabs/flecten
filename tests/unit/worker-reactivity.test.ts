import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileModule } from "svelte/compiler";

test("composer observes Worker starts, restarts, stops and task reset through client reactivity", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "flecten-worker-client-"));
  try {
    // The regular test preload compiles runes for SSR, where render subscriptions do not run.
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../helpers/worker-reactivity-client.svelte.ts")],
      outdir,
      target: "bun",
      conditions: ["browser"],
      plugins: [
        {
          name: "worker-client-runes",
          setup(builder) {
            builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => ({
              contents: compileModule(
                new Bun.Transpiler({ loader: "ts" }).transformSync(await Bun.file(path).text()),
                { filename: path, generate: "client" },
              ).js.code,
              loader: "js",
            }));
          },
        },
      ],
    });
    if (!result.success) throw new AggregateError(result.logs);
    const { verifyWorkerReactivity } = await import(
      join(outdir, "worker-reactivity-client.svelte.js")
    );
    verifyWorkerReactivity();
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
