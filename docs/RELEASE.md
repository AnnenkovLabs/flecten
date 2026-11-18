# Release Process

The canonical version lives in `package.json`. Git tags use a `v` prefix (`v0.1.1`), and each release has a matching `## 0.1.1` section in `CHANGELOG.md` whose body becomes the GitHub Release notes verbatim (without commit dumps, unreleased items, or notes from other versions).

Flecten is currently in Alpha: releases publish to GitHub Releases marked **Pre-release** with full installers attached, staying off the `stable` auto-update channel.

## Local Verification

```bash
bun run verify
bun run package
bun run smoke:packaged
```

`verify` runs unit/integration tests, typechecking, lint, and both UI and sidecar builds. `package` builds the unpacked Electron app under `release/`. `smoke:packaged` boots the packaged binary with an isolated profile (scrubbing dev/agent env overrides), waits for an editable composer and live preload bridge, queries `status` from the renderer, and verifies both the rendered model and the embedded sidecar executable path.

Measure cold-window startup after packaging with `bun scripts/measure-desktop-startup.mjs release/linux-unpacked/flecten` (substitute your platform binary; prefix with `xvfb-run -a` on headless Linux). The benchmark runs five hidden launches with fresh profiles, waiting for backend `status`, rendered model label, editable composer, loaded fonts, and two animation frames; P95 must stay <= 8s (warm OS page cache). `scripts/measure-startup.mjs` separately benchmarks compiled sidecar time-to-first-`status`.

## Installers

`electron-builder.yml` targets `AppImage` on Linux, `DMG` and `ZIP` on macOS (hardened runtime + `build/entitlements.mac.plist`), and `NSIS` on Windows, using `build/icon.png`.

## Auto-Update

Packaged builds check `AnnenkovLabs/flecten` GitHub Releases by default. `update.github` (`owner`, `repo`) overrides the GitHub repository, while `update.feedUrl` or `FLECTEN_UPDATE_URL` points to a generic update server and takes precedence over GitHub. Dev runs without an explicit update source disable update checks completely and hide the status chip.

The GitHub updater queries `GET /repos/{owner}/{repo}/releases` and picks the newest published release by `published_at` (ignoring drafts; `stable` skips prereleases, `beta` includes them). Valid releases must attach channel metadata (`latest*.yml` or `beta*.yml`), matching `*.signed.json` manifests, and installers; missing signatures abort before downloading any installer bytes.

Generic `feedUrl` values (e.g., `https://updates.example.com/flecten/`) require `https://`, allowing `http://` only on loopback (`localhost`, `127.0.0.1`, `[::1]`) and rejecting embedded credentials.

Config section `update` controls `channel` (`beta` default, `stable` for GA), `github`, `feedUrl`, `autoCheck`, `autoDownload`, and `installOnQuit` (all auto flags enabled by default), hot-applied via `status`. Checks run 10s after launch and every 4 hours thereafter (with 15m-4h exponential backoff on failure), downloading in the background with progress in the titlebar chip and installing on explicit restart (`quitAndInstall(false, true)`) or clean exit (`0`) when `installOnQuit` is enabled, never interrupting an active agent run. Automated test runs disable background polling.

Update feeds host `electron-builder` metadata alongside installers:

- Windows: `latest.yml` + NSIS `.exe`
- macOS: `latest-mac.yml` + `.zip` and `.dmg`
- Linux: `latest-linux.yml` + `.AppImage`

`stable` reads `latest*`, whereas `beta` (used by Alpha builds) reads `beta.yml`, `beta-mac.yml`, and `beta-linux.yml` with per-channel signed manifests. Moving to GA requires switching `publish.channel` in `electron-builder.yml` and the release workflow manifest template together. `electron-builder.yml` uses a URL-free `generic` entry solely to emit local `.yml` metadata; CI uploads artifacts without giving `electron-builder` publish tokens.

macOS updates require consistent Apple Developer ID signatures for Squirrel.Mac, Windows enforces Authenticode publisher checks, Linux AppImage verifies SHA-512 digests, and every platform enforces Flecten's pinned Ed25519 manifest signature.

## SBOM and Checksums

```bash
bun run sbom
```

`scripts/sbom.mjs` generates a CycloneDX `1.5` SBOM at `release/sbom.json` offline from `package.json`, `bun.lock`, and installed `node_modules/<name>/package.json` license fields, with zero extra dependencies. `bun run checksums` (`scripts/release-checksums.mjs`) runs `sbom` first so `release/SHA256SUMS.txt` covers `sbom.json`.

## Two-Phase Fast Release

CI pre-builds and verifies a complete release candidate on every `main` push; publishing promotes that exact verified artifact bundle without rebuilding:

1. Bump `version` in `package.json`, add the matching section to `CHANGELOG.md`, commit, and push to `main`.
2. Wait for green CI and the **ready to release** job on that commit SHA (candidates are retained for 14 days).
3. From `main`, run:

```bash
bun run release:publish
```

`release:publish` verifies that local `HEAD` matches remote `main`, locates a green `ci.yml` run for that exact SHA with all required gates passing and candidate artifact intact, creates an annotated `v<version>` tag, and pushes it to trigger `release.yml` (typically completing in 30-90 seconds depending on GitHub queue and upload throughput).

## CI Pipeline (`ci.yml`)

`.github/workflows/ci.yml` runs on PRs, `main` pushes, and manual dispatch across three parallel tracks:

- **verify** (Linux, Windows): unit/integration tests, typecheck, lint, and UI/agent builds.
- **Quality** (reusable workflow): `docs:check`, >= 85% coverage gate, and three parallel headless Electron E2E shards (including visual golden checks at `1480x940` and `1180x640`, preflight, and Computer Use checks), uploading HTML reports, traces, and failure diffs.
- **Build installers** (Linux x64, Windows x64, macOS arm64, macOS x64): full installers on trusted `main` (unpacked builds without signing secrets on PRs), running packaged smoke tests on every OS (including Chromium sandbox on Linux AppImage and standalone sidecar launch on Windows). The macOS arm64 job also runs unit/integration tests, typecheck, and lint before building the UI and agent for packaging, so macOS verification and packaging use one hosted ARM64 runner. The dependency audit runs in parallel and is non-blocking.

**ready to release** gates on `verify`, `Quality`, and all four installer jobs: it merges universal macOS update metadata, signs manifests with Ed25519, generates `sbom.json`, `SHA256SUMS.txt`, changelog release notes, and `release-candidate.json` (binding repo, workflow, exact SHA, version, run ID/attempt, filenames, byte sizes, and SHA-256 digests across all six installers, three beta manifests, signatures, SBOM, and notes; missing OS code-signing certs emit explicit `UNSIGNED-macos.txt` / `UNSIGNED-windows.txt` markers).

## Release Workflow (`release.yml`)

Triggered by a `v*` tag (which must match `package.json`) or manual dispatch on an existing tag:

1. Locate a green `ci.yml` run on `AnnenkovLabs/flecten` `main` (`push` or `workflow_dispatch`) for the exact tagged commit SHA where every required job status is `success` (`skipped`/`neutral` rejected).
2. Download the immutable candidate artifact for that run attempt and re-verify archive SHA-256, file inventory, sizes, digests, provenance, manifest/SBOM versions, and Ed25519 signatures.
3. Create a GitHub Release draft, upload verified artifacts, re-confirm tag SHA parity, and publish as a GitHub Pre-release without rebuilding, running tests, or touching private signing keys.

If no verified candidate exists yet, both `release:publish` and `release.yml` fail fast with a link to CI rather than rebuilding ad hoc. Re-prepare expired `main` artifacts via `gh workflow run ci.yml --ref main` (or **Re-run failed jobs** for transient flakes), and resume interrupted uploads via `gh workflow run release.yml --ref v0.1.2` (idempotent when bytes and release notes match; conflicting bytes require bumping a new version, as published tags are never moved).

## Pre-Release Checklist and Code Signing

Run `bun run verify` once on the finished change (plus visual inspection at `1480x940` and `1180x640` for UI changes). Platform code signing activates when CI secrets are configured:

- macOS Developer ID & notarization: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (via `@electron/notarize` `3.1.2`).
- Windows Authenticode: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (falling back to generic `CSC_*`).

## Update Signing Key and Binary Budgets

CI variable `UPDATE_SIGNING_PUBLIC_KEY` (Ed25519 public PEM) is pinned into `shell/update-public-key.pem` at package time via `bun scripts/sign-update-manifests.mjs --pin` (git-ignored; never read from feeds or runtime env). `UPDATE_SIGNING_PRIVATE_KEY` is exposed solely to `ready to release` on `main` to produce `*.signed.json` manifests; builds without keys emit `UNSIGNED-updates.txt` and are rejected by both the updater and CI release gates. Differential and web installers are disabled.

Size budgets: <= 350 MiB per installer; standalone Bun `1.4.4` sidecar caps are 109 MiB on Linux x64 (measured 107.2 MiB), 115 MiB on Windows x64 (113.0 MiB), 98 MiB on macOS Intel (96.7 MiB), and 90 MiB on macOS Apple Silicon (88.2 MiB). `app-builder-lib` and `@electron/universal` pin `minimatch` `11.0.9` via scoped overrides while `@electron/asar` and `glob` retain their compatible v3/callable branches.

As of November 17, 2026, `bun audit --production` reports zero known vulnerabilities in production dependencies; full `bun audit` flags dev-only [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) in `picomatch` `4.0.7` (via Vite and `tinyglobby`) pending an upstream npm patch.
