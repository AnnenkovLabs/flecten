import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

interface UpdaterStatus {
  state: string;
  enabled: boolean;
  version?: string;
  percent?: number;
  message?: string;
}

interface SbomComponent {
  name?: string;
  version?: string;
  purl?: string;
  licenses?: Array<{ license?: { id?: string; name?: string } }>;
}

interface Sbom {
  bomFormat?: string;
  specVersion?: string;
  serialNumber?: string;
  metadata?: {
    timestamp?: string;
    component?: SbomComponent;
  };
  components?: SbomComponent[];
}

const { mapUpdaterEvent } = require("../../shell/updater.mjs") as {
  mapUpdaterEvent(event: string, payload?: unknown): UpdaterStatus | null;
};
const {
  backgroundCheckDelayMs,
  CHECK_INTERVAL_MS,
  parseUpdateUrl,
  PRODUCT_GITHUB,
  RETRY_BASE_MS,
  updateChannel,
  updateSource,
} = require("../../shell/update-policy.mjs") as {
  backgroundCheckDelayMs(failures: number): number;
  CHECK_INTERVAL_MS: number;
  parseUpdateUrl(value: unknown): string | null;
  PRODUCT_GITHUB: { owner: string; repo: string };
  RETRY_BASE_MS: number;
  updateChannel(channel: unknown): string;
  updateSource(
    settings: { feedUrl?: string; github?: { owner: string; repo: string } },
    envUrl: string | undefined,
    packaged: boolean,
  ):
    | { kind: "feed"; url: string | null }
    | { kind: "github"; owner: string; repo: string }
    | { kind: "none" };
};
const { normalizeUpdateSettings, UPDATE_DEFAULTS } =
  require("../../shared/update-settings.cjs") as {
    normalizeUpdateSettings(value: unknown): {
      channel: "stable" | "beta";
      feedUrl?: string;
      github?: { owner: string; repo: string };
      autoCheck: boolean;
      autoDownload: boolean;
      installOnQuit: boolean;
    };
    UPDATE_DEFAULTS: {
      channel: "stable" | "beta";
      autoCheck: boolean;
      autoDownload: boolean;
      installOnQuit: boolean;
    };
  };

const { buildSbom, generateSbom } = require("../../scripts/sbom.mjs") as {
  buildSbom(options: {
    packageJson: { name?: string; version?: string; license?: string };
    lockText: string;
    rootDir?: string;
    now?: Date;
  }): Sbom;
  generateSbom(options?: { rootDir?: string; outFile?: string }): Sbom;
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "liquid-sbom-"));
  dirs.push(dir);
  mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "liquid-fixture", version: "9.9.9", license: "MIT" }),
  );
  writeFileSync(
    join(dir, "node_modules", "left-pad", "package.json"),
    JSON.stringify({ name: "left-pad", version: "1.3.0", license: "MIT" }),
  );
  writeFileSync(
    join(dir, "bun.lock"),
    `{
  "lockfileVersion": 2,
  "packages": {
    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-x"],
    "@scope/tool": ["@scope/tool@2.0.0", "", {}, "sha512-y"],
  },
}
`,
  );
  return dir;
}

describe("updater URL validation", () => {
  test("accepts https and loopback http feeds", () => {
    expect(parseUpdateUrl("https://updates.example.test/liquid/")).toBe(
      "https://updates.example.test/liquid/",
    );
    expect(parseUpdateUrl("http://127.0.0.1:8080/feed")).toBe("http://127.0.0.1:8080/feed");
    expect(parseUpdateUrl("http://localhost/feed")).toBe("http://localhost/feed");
  });

  test("rejects remote http, credentials and malformed values", () => {
    expect(parseUpdateUrl("http://updates.example.test/liquid")).toBeNull();
    expect(parseUpdateUrl("ftp://updates.example.test/liquid")).toBeNull();
    expect(parseUpdateUrl("https://user:secret@updates.example.test/liquid")).toBeNull();
    expect(parseUpdateUrl("not a url")).toBeNull();
    expect(parseUpdateUrl("")).toBeNull();
    expect(parseUpdateUrl(undefined)).toBeNull();
  });
});

describe("updater state mapping", () => {
  test("maps check and availability events", () => {
    expect(mapUpdaterEvent("checking-for-update")).toEqual({
      state: "checking",
      enabled: true,
    });
    expect(mapUpdaterEvent("update-available", { version: "1.2.3" })).toEqual({
      state: "available",
      enabled: true,
      version: "1.2.3",
    });
    expect(mapUpdaterEvent("update-not-available")).toEqual({ state: "idle", enabled: true });
  });

  test("clamps download progress to whole percentages", () => {
    expect(mapUpdaterEvent("download-progress", { percent: 42.6 })).toEqual({
      state: "downloading",
      enabled: true,
      percent: 43,
    });
    expect(mapUpdaterEvent("download-progress", { percent: -5 })?.percent).toBe(0);
    expect(mapUpdaterEvent("download-progress", { percent: 150 })?.percent).toBe(100);
    expect(mapUpdaterEvent("download-progress", {})?.percent).toBe(0);
  });

  test("maps downloaded and error events", () => {
    expect(mapUpdaterEvent("update-downloaded", { version: "1.2.3" })).toEqual({
      state: "downloaded",
      enabled: true,
      version: "1.2.3",
    });
    expect(mapUpdaterEvent("error", new Error("feed unavailable"))).toEqual({
      state: "error",
      enabled: true,
      message: "feed unavailable",
    });
    expect(mapUpdaterEvent("error", {})?.message).toBe("update failed");
    expect(mapUpdaterEvent("error", "x".repeat(600))?.message?.length).toBe(500);
    expect(mapUpdaterEvent("unknown-event")).toBeNull();
  });
});

describe("update policy", () => {
  test("stable uses the default latest channel files, beta uses beta", () => {
    expect(updateChannel("stable")).toBe("latest");
    expect(updateChannel("beta")).toBe("beta");
    expect(updateChannel("nonsense")).toBe("latest");
  });

  test("source precedence: feed URL, then GitHub config, then product releases when packaged", () => {
    expect(
      updateSource(
        { feedUrl: "https://custom.example.test/feed", github: { owner: "o", repo: "r" } },
        "https://env.example.test/",
        true,
      ),
    ).toEqual({ kind: "feed", url: "https://custom.example.test/feed" });
    expect(updateSource({}, "https://env.example.test/", false)).toEqual({
      kind: "feed",
      url: "https://env.example.test/",
    });
    expect(updateSource({ github: { owner: "o", repo: "r" } }, undefined, true)).toEqual({
      kind: "github",
      owner: "o",
      repo: "r",
    });
    expect(updateSource({}, undefined, true)).toEqual({ kind: "github", ...PRODUCT_GITHUB });
    expect(updateSource({}, undefined, false)).toEqual({ kind: "none" });
    expect(updateSource({ feedUrl: "http://remote.example.test/" }, undefined, true)).toEqual({
      kind: "feed",
      url: null,
    });
  });

  test("failed checks back off from 15 minutes up to the normal interval", () => {
    expect(backgroundCheckDelayMs(0)).toBe(CHECK_INTERVAL_MS);
    expect(backgroundCheckDelayMs(1)).toBe(RETRY_BASE_MS);
    expect(backgroundCheckDelayMs(2)).toBe(RETRY_BASE_MS * 2);
    expect(backgroundCheckDelayMs(3)).toBe(RETRY_BASE_MS * 4);
    expect(backgroundCheckDelayMs(50)).toBe(CHECK_INTERVAL_MS);
  });
});

describe("update settings normalization", () => {
  test("missing or malformed values fall back to automatic defaults", () => {
    for (const value of [undefined, null, 42, "stable", []]) {
      expect(normalizeUpdateSettings(value)).toEqual(UPDATE_DEFAULTS);
    }
    expect(
      normalizeUpdateSettings({ channel: "nightly", autoCheck: "yes", autoDownload: 1 }),
    ).toEqual(UPDATE_DEFAULTS);
  });

  test("valid fields survive and the feed URL is trimmed", () => {
    expect(
      normalizeUpdateSettings({
        channel: "beta",
        feedUrl: "  https://updates.example.test/  ",
        autoCheck: false,
        autoDownload: false,
        installOnQuit: false,
      }),
    ).toEqual({
      channel: "beta",
      feedUrl: "https://updates.example.test/",
      autoCheck: false,
      autoDownload: false,
      installOnQuit: false,
    });
    expect(normalizeUpdateSettings({ feedUrl: "   " }).feedUrl).toBeUndefined();
  });

  test("GitHub source needs a valid owner and repository pair", () => {
    expect(
      normalizeUpdateSettings({ github: { owner: "AnnenkovLabs", repo: "flecten" } }).github,
    ).toEqual({
      owner: "AnnenkovLabs",
      repo: "flecten",
    });
    for (const github of [
      { owner: "only-owner" },
      { owner: "", repo: "r" },
      { owner: "o/r", repo: "r" },
      { owner: "o", repo: "bad repo" },
      { owner: 42, repo: "r" },
      "owner/repo",
    ]) {
      expect(normalizeUpdateSettings({ github }).github).toBeUndefined();
    }
  });

  test("the config schema and the shell boundary agree on defaults", async () => {
    const { UpdateConfigSchema } = await import("../../src/config/schema-sections");
    expect(UpdateConfigSchema.parse({})).toEqual(normalizeUpdateSettings(undefined));
  });
});

describe("SBOM generation", () => {
  test("builds CycloneDX components from package.json and bun.lock", () => {
    const dir = fixture();
    const lockText = readFileSync(join(dir, "bun.lock"), "utf8");
    const sbom = buildSbom({
      packageJson: { name: "liquid-fixture", version: "9.9.9", license: "MIT" },
      lockText,
      rootDir: dir,
      now: new Date("2026-10-25T00:00:00.000Z"),
    });

    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.specVersion).toBe("1.5");
    expect(sbom.serialNumber?.startsWith("urn:uuid:")).toBe(true);
    expect(sbom.metadata?.timestamp).toBe("2026-10-25T00:00:00.000Z");
    expect(sbom.metadata?.component).toMatchObject({
      name: "liquid-fixture",
      version: "9.9.9",
    });
    expect(sbom.components).toHaveLength(2);

    const leftPad = sbom.components?.find((component) => component.name === "left-pad");
    expect(leftPad).toMatchObject({
      version: "1.3.0",
      purl: "pkg:npm/left-pad@1.3.0",
    });
    expect(leftPad?.licenses?.[0]?.license?.id).toBe("MIT");

    const scoped = sbom.components?.find((component) => component.name === "@scope/tool");
    expect(scoped).toMatchObject({
      version: "2.0.0",
      purl: "pkg:npm/%40scope/tool@2.0.0",
    });
    expect(scoped?.licenses).toBeUndefined();
  });

  test("writes release/sbom.json", () => {
    const dir = fixture();
    const outFile = join(dir, "release", "sbom.json");
    const sbom = generateSbom({ rootDir: dir, outFile });
    const written = JSON.parse(readFileSync(outFile, "utf8")) as Sbom;

    expect(sbom.components).toHaveLength(2);
    expect(written.bomFormat).toBe("CycloneDX");
    expect(written.components?.map((component) => component.name).sort()).toEqual([
      "@scope/tool",
      "left-pad",
    ]);
  });
});
