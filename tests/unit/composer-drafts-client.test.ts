import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileModule } from "svelte/compiler";

test("client composer drafts retain startup text and isolate navigation and late attachments", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "flecten-composer-client-"));
  try {
    const built = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../helpers/composer-drafts-client.svelte.ts")],
      outdir,
      target: "bun",
      conditions: ["browser"],
      plugins: [
        {
          name: "composer-client-runes",
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
    if (!built.success) throw new AggregateError(built.logs);
    const { verifyComposerDrafts } = await import(join(outdir, "composer-drafts-client.svelte.js"));
    verifyComposerDrafts();
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
