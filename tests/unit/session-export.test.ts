import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
test("session export copies the durable history through the sidecar command without changing it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-export-"));
  directories.push(cwd);
  const source = join(cwd, ".liquid", "sessions", "s_export", "events.jsonl");
  await mkdir(join(cwd, ".liquid", "sessions", "s_export"), { recursive: true });
  const media = join(dirname(source), "attachments");
  await mkdir(media);
  const bytes = new Uint8Array([0, 1, 2, 3, 255]);
  await Bun.write(join(media, "saved.bin"), bytes);
  await Bun.write(
    source,
    '{"schemaVersion":1,"event":{"type":"notice.applied","text":"saved history"}}\n',
  );
  await Bun.write(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      provider: "test",
      model: "test",
      catalog: { autoRefresh: false },
      providers: {
        test: { protocol: "openai-chat", baseUrl: "http://localhost:12345", models: { test: {} } },
      },
    }),
  );
  const app = await createAppService(cwd);
  try {
    const handler = createHandlers(app, () => undefined)["sessions.export"];
    const result = (await handler({ type: "sessions.export", id: "s_export" })) as {
      exported: { path: string };
    };
    expect(await Bun.file(result.exported.path).text()).toBe(await Bun.file(source).text());
    expect(result.exported.path.startsWith(join(cwd, ".liquid", "exports"))).toBe(true);
    expect((await stat(source)).size).toBeGreaterThan(0);
    const exportedDirectory = dirname(result.exported.path);
    expect(await Bun.file(join(exportedDirectory, "attachments", "saved.bin")).bytes()).toEqual(
      bytes,
    );
    if (process.platform !== "win32") {
      expect((await stat(exportedDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(result.exported.path)).mode & 0o777).toBe(0o600);
    }
    await Bun.write(join(media, "saved.bin"), "changed");
    await rm(source);
    expect(await Bun.file(result.exported.path).text()).toContain("saved history");
    expect(await Bun.file(join(exportedDirectory, "attachments", "saved.bin")).bytes()).toEqual(
      bytes,
    );
    await Bun.write(source, "restored history");
    if (process.platform === "win32") await mkdir(join(media, "invalid-directory"));
    else await symlink(join(media, "saved.bin"), join(media, "symlink.bin"));
    await expect(handler({ type: "sessions.export", id: "s_export" })).rejects.toThrow(
      "non-regular attachments",
    );
    expect(await readdir(join(cwd, ".liquid", "exports"))).toEqual([basename(exportedDirectory)]);
    await expect(handler({ type: "sessions.export", id: "../escape" })).rejects.toThrow();
  } finally {
    await app.dispose();
  }
});
