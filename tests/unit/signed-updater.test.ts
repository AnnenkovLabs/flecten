import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createUpdater } = require("../../shell/updater.mjs");
const {
  CHECK_INTERVAL_MS,
  RETRY_BASE_MS,
  STARTUP_CHECK_DELAY_MS,
} = require("../../shell/update-policy.mjs");
const { AppImageUpdater } = require("electron-updater/out/AppImageUpdater.js");
const { ElectronHttpExecutor } = require("electron-updater/out/electronHttpExecutor.js");
const { NodeHttpExecutor } = require("builder-util/out/nodeHttpExecutor.js");
const { pinUpdateKey, signUpdateManifests } = require("../../scripts/sign-update-manifests.mjs");

const MANUAL_SETTINGS = { autoCheck: false, autoDownload: false, installOnQuit: false };

interface FakeClock {
  timers: {
    setTimeout(fn: () => unknown, ms: number): number;
    clearTimeout(handle: number): void;
  };
  delays(): number[];
  fireNext(): Promise<void>;
}

function fakeTimers(): FakeClock {
  const pending = new Map<number, { fn: () => unknown; ms: number }>();
  let nextId = 1;
  return {
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++;
        pending.set(id, { fn, ms });
        return id;
      },
      clearTimeout(handle) {
        pending.delete(handle);
      },
    },
    delays: () => [...pending.values()].map((entry) => entry.ms),
    async fireNext() {
      const entry = pending.entries().next().value;
      if (!entry) throw new Error("no scheduled check");
      pending.delete(entry[0]);
      await entry[1].fn();
    },
  };
}

async function waitForState(
  app: { state(): { state: string } },
  state: string,
  timeoutMs = 5000,
): Promise<{ state: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = app.state();
    if (current.state === state || current.state === "error") return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return app.state();
}

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-signed-update-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const channel = `latest-linux${process.arch === "x64" ? "" : `-${process.arch}`}`;
  const artifact = "Flecten-2.0.0-linux.AppImage";
  const bytes = Buffer.from("verified release artifact");
  const info = {
    version: "2.0.0",
    files: [
      {
        url: artifact,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      },
    ],
  };
  await writeFile(join(cwd, artifact), bytes);
  await writeFile(join(cwd, `${channel}.yml`), JSON.stringify(info));
  await signUpdateManifests({
    directory: cwd,
    privateKey: privatePem,
    publicKey: publicPem,
    version: "2.0.0",
  });
  const signed = JSON.parse(await readFile(join(cwd, `${channel}.signed.json`), "utf8")) as {
    payload: string;
    signature: string;
  };
  const betaChannel = `beta-linux${process.arch === "x64" ? "" : `-${process.arch}`}`;
  const betaArtifact = "Flecten-2.1.0-linux.AppImage";
  const betaBytes = Buffer.from("verified beta artifact");
  const betaInfo = {
    version: "2.1.0",
    files: [
      {
        url: betaArtifact,
        size: betaBytes.length,
        sha512: createHash("sha512").update(betaBytes).digest("base64"),
      },
    ],
  };
  const betaDir = join(cwd, "beta-sign");
  await mkdir(betaDir);
  await writeFile(join(betaDir, betaArtifact), betaBytes);
  await writeFile(join(betaDir, `${betaChannel}.yml`), JSON.stringify(betaInfo));
  await signUpdateManifests({
    directory: betaDir,
    privateKey: privatePem,
    publicKey: publicPem,
    version: "2.1.0",
  });
  for (const name of [betaArtifact, `${betaChannel}.yml`, `${betaChannel}.signed.json`]) {
    await copyFile(join(betaDir, name), join(cwd, name));
  }
  const betaSigned = JSON.parse(await readFile(join(cwd, `${betaChannel}.signed.json`), "utf8"));
  const transport = { info, signed: signed as unknown, bytes };
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === `/${channel}.yml`) return Response.json(transport.info);
      if (path === `/${channel}.signed.json`) return Response.json(transport.signed);
      if (path === `/${artifact}`) return new Response(transport.bytes);
      if (path === `/${betaChannel}.yml`) return Response.json(betaInfo);
      if (path === `/${betaChannel}.signed.json`) return Response.json(betaSigned);
      if (path === `/${betaArtifact}`) return new Response(betaBytes);
      return new Response("missing", { status: 404 });
    },
  });
  cleanups.push(async () => {
    server.stop(true);
  });
  await mkdir(join(cwd, "cache"));
  await writeFile(join(cwd, "app-update.yml"), "updaterCacheDirName: test\n");
  const oldAppImage = process.env.APPIMAGE;
  process.env.APPIMAGE = join(cwd, "current.AppImage");
  cleanups.push(async () => {
    if (oldAppImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = oldAppImage;
  });
  let quitHandler: ((exitCode: number) => void) | undefined;
  const updater = new AppImageUpdater(null, {
    version: "1.0.0",
    name: "Flecten test",
    isPackaged: true,
    userDataPath: cwd,
    baseCachePath: join(cwd, "cache"),
    appUpdateConfigPath: join(cwd, "app-update.yml"),
    whenReady: async () => undefined,
    onQuit: (handler: (exitCode: number) => void) => {
      quitHandler = handler;
    },
  });
  // Keep electron-updater's actual download/checksum pipeline; replace only Electron's socket transport.
  const executor = new ElectronHttpExecutor();
  executor.createRequest = NodeHttpExecutor.prototype.createRequest;
  updater.httpExecutor = executor;
  updater._testOnlyOptions = { platform: "linux" };
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  let installs = 0;
  updater.quitAndInstall = () => {
    installs += 1;
  };
  updater.install = () => {
    installs += 1;
    return true;
  };
  const url = `http://127.0.0.1:${server.port}/`;
  const controller = (key = publicPem, settings = MANUAL_SETTINGS, deps = {}) =>
    createUpdater(
      { source: { kind: "feed", url }, emit: () => undefined, settings },
      { updater, publicKey: key, ...deps },
    );
  return {
    cwd,
    privatePem,
    publicPem,
    channel,
    betaChannel,
    artifact,
    bytes,
    info,
    transport,
    paths,
    url,
    updater,
    controller,
    installs: () => installs,
    quit: (exitCode: number) => quitHandler?.(exitCode),
  };
}

describe("signed update channel", () => {
  test("the real updater checks signed metadata, downloads verified bytes only on request and installs only on request", async () => {
    const f = await fixture();
    const app = f.controller();
    expect((await app.check()).state).toBe("available");
    expect(f.paths).not.toContain(`/${f.artifact}`);
    expect(f.updater.autoDownload).toBe(false);
    expect(f.updater.autoInstallOnAppQuit).toBe(false);
    expect((await app.download()).state).toBe("downloaded");
    expect(await readFile(f.updater.installerPath)).toEqual(f.bytes);
    expect(f.installs()).toBe(0);
    await app.check();
    expect(f.installs()).toBe(0);
    app.install();
    expect(f.installs()).toBe(1);
  });

  test("missing key, unsigned metadata, changed signature and wrong trusted key fail before any artifact download", async () => {
    for (const kind of ["missing-key", "unsigned", "tampered", "wrong-key"] as const) {
      const f = await fixture();
      let key = f.publicPem;
      if (kind === "missing-key") key = "";
      if (kind === "unsigned") f.transport.signed = {};
      if (kind === "tampered") {
        const signed = f.transport.signed as { payload: string; signature: string };
        f.transport.signed = { ...signed, payload: `${signed.payload} ` };
      }
      if (kind === "wrong-key")
        key = generateKeyPairSync("ed25519")
          .publicKey.export({ type: "spki", format: "pem" })
          .toString();
      const app = f.controller(key);
      expect((await app.check()).state).toBe("error");
      expect((await app.download()).state).toBe("error");
      expect(f.paths).not.toContain(`/${f.artifact}`);
      app.install();
      expect(f.installs()).toBe(0);
    }
  });

  test("unsigned version, artifact checksum or artifact name cannot override the signed release", async () => {
    for (const field of ["version", "sha512", "url"] as const) {
      const f = await fixture();
      const file = f.transport.info.files[0];
      if (!file) throw new Error("fixture has no update file");
      if (field === "version") f.transport.info.version = "3.0.0";
      if (field === "sha512") file.sha512 = createHash("sha512").update("other").digest("base64");
      if (field === "url") file.url = "other.AppImage";
      const app = f.controller();
      expect((await app.check()).state).toBe("error");
      await app.download();
      expect(f.paths).not.toContain(`/${f.artifact}`);
      expect(f.installs()).toBe(0);
    }
  });

  test("a changed artifact after checking fails the real SHA512 downloader and is never installable", async () => {
    const f = await fixture();
    const app = f.controller();
    expect((await app.check()).state).toBe("available");
    f.transport.bytes = Buffer.from("tampered release artifact");
    const result = await app.download();
    expect(result.state).toBe("error");
    expect(result.message.toLowerCase()).toContain("checksum");
    app.install();
    expect(f.installs()).toBe(0);
  });

  test("replacing checked metadata before downloading cannot bypass the provider's approved snapshot", async () => {
    const f = await fixture();
    const app = f.controller();
    await app.check();
    expect(Object.isFrozen(f.updater.updateInfoAndProvider.info)).toBe(true);
    f.updater.updateInfoAndProvider.info = { ...f.info };
    expect((await app.download()).state).toBe("error");
    expect(f.paths).not.toContain(`/${f.artifact}`);
    expect(f.installs()).toBe(0);
  });

  test("the release signer pins public material, rejects mismatched keys and refuses changed artifacts", async () => {
    const f = await fixture();
    const path = join(f.cwd, "pinned.pem");
    await pinUpdateKey(f.publicPem, path);
    expect(await readFile(path, "utf8")).toBe(f.publicPem);
    const other = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    await expect(
      signUpdateManifests({
        directory: f.cwd,
        privateKey: f.privatePem,
        publicKey: other,
        version: "2.0.0",
      }),
    ).rejects.toThrow("does not match");
    await writeFile(join(f.cwd, f.artifact), "altered artifact bytes");
    await expect(
      signUpdateManifests({
        directory: f.cwd,
        privateKey: f.privatePem,
        publicKey: other,
        version: "2.0.0",
      }),
    ).rejects.toThrow();
  });

  test("automatic settings download the verified update in the background and arm install on quit", async () => {
    const f = await fixture();
    const app = f.controller(f.publicPem, {
      autoCheck: false,
      autoDownload: true,
      installOnQuit: true,
    });
    await app.check();
    const result = await waitForState(app, "downloaded");
    expect(result.state).toBe("downloaded");
    expect(f.paths).toContain(`/${f.artifact}`);
    expect(f.updater.autoInstallOnAppQuit).toBe(true);
    expect(f.installs()).toBe(0);
    f.quit(1);
    expect(f.installs()).toBe(0);
    f.quit(0);
    expect(f.installs()).toBe(1);
  });

  test("the background schedule checks at startup and then every four hours", async () => {
    const f = await fixture();
    const clock = fakeTimers();
    const app = f.controller(
      f.publicPem,
      { autoCheck: true, autoDownload: false, installOnQuit: false },
      { timers: clock.timers },
    );
    expect(clock.delays()).toEqual([STARTUP_CHECK_DELAY_MS]);
    await clock.fireNext();
    expect(app.state().state).toBe("available");
    expect(clock.delays()).toEqual([CHECK_INTERVAL_MS]);
    await clock.fireNext();
    expect(app.state().state).toBe("available");
    expect(clock.delays()).toEqual([CHECK_INTERVAL_MS]);
  });

  test("failed background checks back off exponentially up to the normal interval", async () => {
    const f = await fixture();
    f.transport.signed = {};
    const clock = fakeTimers();
    const app = f.controller(
      f.publicPem,
      { autoCheck: true, autoDownload: false, installOnQuit: false },
      { timers: clock.timers },
    );
    await clock.fireNext();
    expect(app.state().state).toBe("error");
    expect(clock.delays()).toEqual([RETRY_BASE_MS]);
    await clock.fireNext();
    expect(clock.delays()).toEqual([RETRY_BASE_MS * 2]);
    await clock.fireNext();
    expect(clock.delays()).toEqual([RETRY_BASE_MS * 4]);
  });

  test("automated builds never schedule background checks", async () => {
    const f = await fixture();
    const clock = fakeTimers();
    createUpdater(
      {
        source: { kind: "feed", url: f.url },
        emit: () => undefined,
        settings: { autoCheck: true, autoDownload: true, installOnQuit: true },
        automated: true,
      },
      { updater: f.updater, publicKey: f.publicPem, timers: clock.timers },
    );
    expect(clock.delays()).toEqual([]);
  });

  test("applying settings switches the signed channel and install-on-quit without a restart", async () => {
    const f = await fixture();
    const app = f.controller();
    expect((await app.check()).version).toBe("2.0.0");
    app.apply({
      source: { kind: "feed", url: f.url },
      settings: { ...MANUAL_SETTINGS, channel: "beta", installOnQuit: true },
    });
    expect(app.state().state).toBe("idle");
    expect(f.updater.autoInstallOnAppQuit).toBe(true);
    const result = await app.check();
    expect(result.state).toBe("available");
    expect(result.version).toBe("2.1.0");
    expect(f.paths).toContain(`/${f.betaChannel}.signed.json`);
  });

  test("dispose cancels the schedule and detaches from the updater", async () => {
    const f = await fixture();
    const clock = fakeTimers();
    const app = f.controller(
      f.publicPem,
      { autoCheck: true, autoDownload: false, installOnQuit: false },
      { timers: clock.timers },
    );
    app.dispose();
    expect(clock.delays()).toEqual([]);
    const before = f.paths.length;
    await app.check();
    expect(f.paths.length).toBe(before);
  });
});
