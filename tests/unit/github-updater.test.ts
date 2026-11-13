import { afterEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createUpdater } = require("../../shell/updater.mjs");
const { latestRelease } = require("../../shell/github-update-provider.mjs");
const { AppImageUpdater } = require("electron-updater/out/AppImageUpdater.js");
const { ElectronHttpExecutor } = require("electron-updater/out/electronHttpExecutor.js");
const { NodeHttpExecutor } = require("builder-util/out/nodeHttpExecutor.js");
const { signUpdateManifests } = require("../../scripts/sign-update-manifests.mjs");

const MANUAL_SETTINGS = { autoCheck: false, autoDownload: false, installOnQuit: false };
const OWNER = "testowner";
const REPO = "testrepo";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

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

async function signedChannel(
  cwd: string,
  name: string,
  version: string,
  artifact: string,
  bytes: Buffer<ArrayBuffer>,
  privatePem: string,
  publicPem: string,
) {
  const dir = join(cwd, `sign-${name}-${version}`);
  await mkdir(dir);
  const info = {
    version,
    files: [
      {
        url: artifact,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      },
    ],
  };
  await writeFile(join(dir, artifact), bytes);
  await writeFile(join(dir, `${name}.yml`), JSON.stringify(info));
  await signUpdateManifests({
    directory: dir,
    privateKey: privatePem,
    publicKey: publicPem,
    version,
  });
  const signed = JSON.parse(await readFile(join(dir, `${name}.signed.json`), "utf8"));
  return { info, signed, artifact, bytes };
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-github-update-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const archSuffix = process.arch === "x64" ? "" : `-${process.arch}`;
  const stableChannel = `latest-linux${archSuffix}`;
  const betaChannel = `beta-linux${archSuffix}`;
  const stable = await signedChannel(
    cwd,
    stableChannel,
    "2.0.0",
    "Flecten-2.0.0-linux.AppImage",
    Buffer.from("stable release artifact"),
    privatePem,
    publicPem,
  );
  const beta = await signedChannel(
    cwd,
    betaChannel,
    "2.1.0-beta.1",
    "Flecten-2.1.0-beta.1-linux.AppImage",
    Buffer.from("beta release artifact"),
    privatePem,
    publicPem,
  );
  const old = await signedChannel(
    cwd,
    stableChannel,
    "1.5.0",
    "Flecten-1.5.0-linux.AppImage",
    Buffer.from("old release artifact"),
    privatePem,
    publicPem,
  );

  const paths: string[] = [];
  const state = {
    stableSigned: stable.signed as unknown,
    releases: [] as Array<Record<string, unknown>>,
  };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === `/repos/${OWNER}/${REPO}/releases`) return Response.json(state.releases);
      const download = path.match(/^\/download\/([^/]+)\/([^/]+)$/);
      if (download) {
        const [, tag, name] = download;
        const channel = tag === "v2.1.0-beta.1" ? beta : tag === "v1.5.0" ? old : stable;
        if (name === channel.artifact) return new Response(channel.bytes);
        if (name === `${tag === "v2.1.0-beta.1" ? betaChannel : stableChannel}.yml`)
          return Response.json(channel.info);
        if (name === `${tag === "v2.1.0-beta.1" ? betaChannel : stableChannel}.signed.json`)
          return Response.json(tag === "v2.1.0-beta.1" ? beta.signed : state.stableSigned);
      }
      return new Response("missing", { status: 404 });
    },
  });
  cleanups.push(async () => {
    server.stop(true);
  });
  const base = `http://127.0.0.1:${server.port}`;
  const release = (
    tag: string,
    publishedAt: string,
    names: string[],
    flags: { draft?: boolean; prerelease?: boolean } = {},
  ) => ({
    tag_name: tag,
    draft: flags.draft ?? false,
    prerelease: flags.prerelease ?? false,
    published_at: publishedAt,
    assets: names.map((name) => ({
      name,
      browser_download_url: `${base}/download/${tag}/${name}`,
    })),
  });
  state.releases = [
    release("v1.5.0", "2026-11-01T10:00:00Z", [
      stableChannel + ".yml",
      stableChannel + ".signed.json",
      old.artifact,
    ]),
    release("v9.9.9", "2026-11-12T10:00:00Z", [], { draft: true }),
    release("v2.0.0", "2026-11-09T10:00:00Z", [
      stableChannel + ".yml",
      stableChannel + ".signed.json",
      stable.artifact,
    ]),
    release(
      "v2.1.0-beta.1",
      "2026-11-10T10:00:00Z",
      [betaChannel + ".yml", betaChannel + ".signed.json", beta.artifact],
      { prerelease: true },
    ),
  ];

  await mkdir(join(cwd, "cache"));
  await writeFile(join(cwd, "app-update.yml"), "updaterCacheDirName: test\n");
  const oldAppImage = process.env.APPIMAGE;
  process.env.APPIMAGE = join(cwd, "current.AppImage");
  cleanups.push(async () => {
    if (oldAppImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = oldAppImage;
  });
  const updater = new AppImageUpdater(null, {
    version: "1.0.0",
    name: "Flecten test",
    isPackaged: true,
    userDataPath: cwd,
    baseCachePath: join(cwd, "cache"),
    appUpdateConfigPath: join(cwd, "app-update.yml"),
    whenReady: async () => undefined,
    onQuit: () => undefined,
  });
  const executor = new ElectronHttpExecutor();
  executor.createRequest = NodeHttpExecutor.prototype.createRequest;
  updater.httpExecutor = executor;
  updater._testOnlyOptions = { platform: "linux" };
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  updater.quitAndInstall = () => undefined;
  updater.install = () => true;
  const controller = (settings = MANUAL_SETTINGS, key = publicPem) =>
    createUpdater(
      {
        source: { kind: "github", owner: OWNER, repo: REPO },
        emit: () => undefined,
        settings,
      },
      { updater, publicKey: key, githubApiRoot: base },
    );
  return {
    cwd,
    paths,
    state,
    stable,
    beta,
    stableChannel,
    betaChannel,
    controller,
    updater,
    releases: state.releases,
  };
}

describe("latestRelease selection", () => {
  const release = (
    tag: string,
    publishedAt: number,
    flags: { draft?: boolean; prerelease?: boolean } = {},
  ) => ({
    tag,
    publishedAt,
    draft: flags.draft ?? false,
    prerelease: flags.prerelease ?? false,
    assets: [],
  });

  test("newest published wins, drafts never count, stable skips prereleases", () => {
    const releases = [
      release("old", 100),
      release("draft", 400, { draft: true }),
      release("pre", 300, { prerelease: true }),
      release("new", 200),
    ];
    expect(latestRelease(releases, false)?.tag).toBe("new");
    expect(latestRelease(releases, true)?.tag).toBe("pre");
    expect(latestRelease([release("draft", 1, { draft: true })], true)).toBeNull();
    expect(latestRelease([], false)).toBeNull();
  });
});

describe("GitHub releases update source", () => {
  test("stable picks the newest published release, skips drafts and prereleases, and verifies bytes", async () => {
    const f = await fixture();
    const app = f.controller({ autoCheck: false, autoDownload: true, installOnQuit: false });
    await app.check();
    const result = await waitForState(app, "downloaded");
    expect(result.state).toBe("downloaded");
    expect((result as { version?: string }).version).toBe("2.0.0");
    expect(f.paths).toContain(`/repos/${OWNER}/${REPO}/releases`);
    expect(f.paths).toContain(`/download/v2.0.0/${f.stable.artifact}`);
    expect(
      f.paths.some(
        (path) =>
          path.includes("v9.9.9") || path.includes("v2.1.0-beta.1") || path.includes("v1.5.0"),
      ),
    ).toBe(false);
    expect(await readFile(f.updater.installerPath)).toEqual(f.stable.bytes);
  });

  test("beta channel takes the newest prerelease", async () => {
    const f = await fixture();
    const app = f.controller();
    app.apply({
      source: { kind: "github", owner: OWNER, repo: REPO },
      settings: { ...MANUAL_SETTINGS, channel: "beta" },
    });
    const result = await app.check();
    expect(result.state).toBe("available");
    expect(result.version).toBe("2.1.0-beta.1");
    expect(f.paths).toContain(`/download/v2.1.0-beta.1/${f.betaChannel}.signed.json`);
  });

  test("a tampered signed manifest blocks the release before any artifact download", async () => {
    const f = await fixture();
    f.state.stableSigned = {};
    const app = f.controller();
    const result = await app.check();
    expect(result.state).toBe("error");
    expect(f.paths.some((path) => path.endsWith(".AppImage"))).toBe(false);
  });

  test("the newest release without channel metadata is an explicit error", async () => {
    const f = await fixture();
    const newest = f.releases.find((release) => release.tag_name === "v2.0.0") as {
      assets: Array<{ name: string }>;
    };
    newest.assets = newest.assets.filter((asset) => !asset.name.endsWith(".yml"));
    const app = f.controller();
    const result = await app.check();
    expect(result.state).toBe("error");
    expect(result.message).toContain(f.stableChannel);
  });

  test("no published stable releases means no update and a clear error", async () => {
    const f = await fixture();
    f.state.releases = f.state.releases.filter(
      (release) => release.prerelease === true || release.draft === true,
    );
    const app = f.controller();
    const result = await app.check();
    expect(result.state).toBe("error");
    expect(result.message).toContain("No published");
  });
});
