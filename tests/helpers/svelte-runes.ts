import { beforeEach } from "bun:test";
import { compileModule } from "svelte/compiler";

// Bun 1.4 coverage crashes on long data: URLs. Load the real modules so coverage
// retains their source paths and does not count a bundled copy of the runtime.
await Bun.plugin({
  name: "test-svelte-runes",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => ({
      contents: compileModule(
        new Bun.Transpiler({ loader: "ts" }).transformSync(await Bun.file(path).text()),
        { filename: path, generate: "server" },
      ).js.code,
      loader: "js",
    }));
  },
});

// Existing behavior fixtures use Russian; localization tests choose their own language.
const { setLocale } = await import("../../ui/src/lib/i18n.svelte");
beforeEach(() => setLocale("ru"));
