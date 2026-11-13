import { createRequire } from "node:module";
import { isGithubName } from "../shared/update-settings.cjs";
import { parseUpdateUrl } from "./update-policy.mjs";
import { matchUpdateInfo, verifyUpdateManifest } from "./update-signature.mjs";

const require = createRequire(import.meta.url);
const { Provider, parseUpdateInfo } = require("electron-updater/out/providers/Provider.js");

const API_ROOT = "https://api.github.com";
const RELEASES_PAGE_SIZE = 30;

function validatedReleases(value) {
  if (!Array.isArray(value)) throw new Error("GitHub releases response is not a list.");
  return value.map((release) => {
    if (!release || typeof release !== "object" || typeof release.tag_name !== "string" || !release.tag_name)
      throw new Error("GitHub release has no tag.");
    if (typeof release.draft !== "boolean" || typeof release.prerelease !== "boolean")
      throw new Error("GitHub release has no draft or prerelease flag.");
    const publishedAt = typeof release.published_at === "string" ? Date.parse(release.published_at) : NaN;
    if (!Number.isFinite(publishedAt)) throw new Error("GitHub release has no publish date.");
    if (!Array.isArray(release.assets)) throw new Error("GitHub release has no asset list.");
    const assets = release.assets.map((asset) => {
      if (!asset || typeof asset.name !== "string" || !asset.name || typeof asset.browser_download_url !== "string")
        throw new Error("GitHub release asset is invalid.");
      const url = new URL(asset.browser_download_url);
      if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
        throw new Error("GitHub asset download URL must be https.");
      return Object.freeze({ name: asset.name, url: url.toString() });
    });
    return Object.freeze({
      tag: release.tag_name,
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt,
      assets: Object.freeze(assets),
    });
  });
}

/** Newest published release by date; drafts never count, stable skips prereleases. */
export function latestRelease(releases, includePrerelease) {
  const candidates = releases.filter((release) => !release.draft && (includePrerelease || !release.prerelease));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, release) => (release.publishedAt > best.publishedAt ? release : best));
}

/**
 * GitHub Releases source: lists releases through the REST API, picks the newest
 * published one for the channel and verifies its signed manifest before any
 * artifact download, reusing electron-updater's checksum pipeline.
 */
export function githubUpdateProvider(publicKey, apiRoot = API_ROOT) {
  const parsed = parseUpdateUrl(apiRoot);
  if (!parsed) throw new Error("GitHub API root must be https or loopback.");
  const root = new URL(parsed).origin;
  return class GitHubReleasesProvider extends Provider {
    #approved = null;
    #assets = null;

    constructor(options, updater, runtimeOptions) {
      super(runtimeOptions);
      if (!isGithubName(options.owner) || !isGithubName(options.repo))
        throw new Error("GitHub update source needs a valid owner and repository.");
      this.owner = options.owner;
      this.repo = options.repo;
      this.updater = updater;
    }

    get channel() {
      const result = this.updater.channel;
      return result == null ? this.getDefaultChannelName() : this.getCustomChannelName(result);
    }

    async getLatestVersion() {
      const listUrl = new URL(`${root}/repos/${this.owner}/${this.repo}/releases?per_page=${RELEASES_PAGE_SIZE}`);
      const raw = await this.httpRequest(listUrl, {
        accept: "application/vnd.github+json",
        "user-agent": "flecten-updater",
      });
      const releases = validatedReleases(JSON.parse(raw));
      const includePrerelease = this.updater.channel === "beta";
      const release = latestRelease(releases, includePrerelease);
      if (!release)
        throw new Error(`No published ${includePrerelease ? "" : "stable "}releases in ${this.owner}/${this.repo}.`);
      const channelFile = `${this.channel}.yml`;
      const manifestFile = `${this.channel}.signed.json`;
      const metadataAsset = release.assets.find((asset) => asset.name === channelFile);
      const manifestAsset = release.assets.find((asset) => asset.name === manifestFile);
      if (!metadataAsset) throw new Error(`Cannot find ${channelFile} in release ${release.tag}.`);
      if (!manifestAsset) throw new Error(`Cannot find ${manifestFile} in release ${release.tag}.`);
      const metadataUrl = new URL(metadataAsset.url);
      const unsigned = parseUpdateInfo(await this.httpRequest(metadataUrl), channelFile, metadataUrl);
      const envelope = JSON.parse(await this.httpRequest(new URL(manifestAsset.url), { accept: "application/json" }));
      const signed = verifyUpdateManifest(envelope, publicKey, this.channel);
      const info = matchUpdateInfo(unsigned, signed);
      const result = Object.freeze({ ...info, tag: release.tag });
      this.#approved = result;
      this.#assets = new Map(release.assets.map((asset) => [asset.name, asset.url]));
      return result;
    }

    resolveFiles(updateInfo) {
      if (!this.#approved || updateInfo !== this.#approved)
        throw new Error("Update download requires verified signed metadata.");
      return this.#approved.files.map((file) => {
        const url = this.#assets?.get(file.url);
        if (!url) throw new Error(`Release asset ${file.url} is missing.`);
        return { url: new URL(url), info: file };
      });
    }
  };
}