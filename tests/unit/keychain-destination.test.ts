import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "linux")(
  "config loading never reuses a keychain credential for another project or destination",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "liquid-keychain-scope-"));
    try {
      const vault = join(directory, "vault.json");
      const program = join(directory, "secret-tool");
      await writeFile(vault, JSON.stringify({ openai: "legacy-unbound-key" }));
      await writeFile(
        program,
        `#!${process.execPath}
const args = process.argv.slice(2);
const file = ${JSON.stringify(vault)};
const records = await Bun.file(file).json();
const name = args[args.indexOf("key") + 1];
const key = args[args.indexOf("service") + 1] + ":" + name;
if (args[0] === "lookup") process.stdout.write(records[key] ?? "");
if (args[0] === "store") records[key] = await new Response(Bun.stdin.stream()).text();
if (args[0] === "clear") delete records[key];
if (args[0] !== "lookup") await Bun.write(file, JSON.stringify(records));
`,
      );
      await chmod(program, 0o755);
      for (const name of ["first", "second"]) await mkdir(join(directory, name));
      const loader = new URL("../../src/config/load.ts", import.meta.url).href;
      const secrets = new URL("../../src/config/secrets.ts", import.meta.url).href;
      const code = `
        import { join } from "node:path";
        const { loadConfig, saveConfig } = await import(${JSON.stringify(loader)});
        const { setSecretBackend } = await import(${JSON.stringify(secrets)});
        setSecretBackend("keychain");
        for (const key of ["FLECTEN_CONFIG", "FLECTEN_PROVIDER", "FLECTEN_MODEL"]) delete process.env[key];
        const first = join(process.argv[1], "first"), second = join(process.argv[1], "second");
        const config = await loadConfig(first);
        if (config.providers.openai.apiKey) throw new Error("Legacy key was reused");
        config.providers.openai.apiKey = "bound-project-key";
        await saveConfig(first, config);
        const vault = ${JSON.stringify(vault)};
        const records = await Bun.file(vault).json();
        const current = Object.keys(records).find((key) => key.startsWith("flecten:"));
        if (!current) throw new Error("New credential namespace was not used");
        records["liquid-harness:" + current.slice("flecten:".length)] = records[current];
        delete records[current];
        await Bun.write(vault, JSON.stringify(records));
        if ((await loadConfig(first)).providers.openai.apiKey !== "bound-project-key") throw new Error("Original credential lost");
        if ((await loadConfig(second)).providers.openai.apiKey) throw new Error("Cross-project credential leak");
        const path = join(first, "flecten.config.json");
        const saved = await Bun.file(path).json();
        const original = saved.providers.openai.baseUrl;
        saved.providers.openai.baseUrl = "https://different.invalid/v1";
        await Bun.write(path, JSON.stringify(saved));
        if ((await loadConfig(first)).providers.openai.apiKey) throw new Error("Cross-destination credential leak");
        saved.providers.openai.baseUrl = original;
        await Bun.write(path, JSON.stringify(saved));
        const restored = await loadConfig(first);
        if (restored.providers.openai.apiKey !== "bound-project-key") throw new Error("Bound credential was destroyed");
        await saveConfig(first, restored, { clearSecrets: ["openai"] });
        if ((await loadConfig(first)).providers.openai.apiKey) throw new Error("Credential deletion failed");
        console.log("keychain isolation passed");
      `;
      const child = Bun.spawn([process.execPath, "-e", code, directory], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(status, error).toBe(0);
      expect(output.trim()).toBe("keychain isolation passed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  20_000,
);
