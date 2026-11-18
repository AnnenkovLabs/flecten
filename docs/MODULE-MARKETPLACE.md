# Module Marketplace

**Settings > Modules > Marketplace** lists modules from explicitly configured catalog URLs. The built-in catalog ships empty. Installations run through the standard module package reader without invoking any model, and newly installed packages execute no code until explicitly trusted.

## Built-In Catalog

`src/marketplace/index.json` ships an empty `Flecten` catalog validated against the same schema as remote HTTPS catalogs and compiled directly into the binary. The `bundled` source makes zero GitHub or network requests, ignores legacy package directories, and stays empty offline. Stale remote caches cannot resurrect removed bundled listings after an app update or **Refresh marketplace**.

Historical example modules live exclusively under `tests/fixtures/modules/` to test the SDK, platform services, and module lifecycle; neither the app nor release installers ship them, and the build pipeline cleans up any leftover `dist/module-marketplace` directory.

Removing an entry from a remote catalog leaves already installed project modules, their trust grants, and configured HTTPS catalog URLs untouched. Installed packages are managed under the **Installed** tab.

## External Catalogs

Under **Catalog sources**, enter an HTTPS JSON catalog URL (no embedded credentials or URL fragments) and click **Add catalog**. Up to eight URLs are stored in `modules.marketplaces` in project configuration. The full catalog document is schema-validated before saving; source failures are isolated per catalog, and **Refresh marketplace** retries fetching.

```json
{
  "schemaVersion": 1,
  "name": "Example modules",
  "modules": [
    {
      "title": "Project guide",
      "publisher": "Example team",
      "category": "workflow",
      "manifest": {
        "schemaVersion": 1,
        "name": "project-guide",
        "version": "1.0.0",
        "description": "Project guidance loaded on demand",
        "instructions": ["instructions.md"]
      },
      "revision": "<SHA-256 returned by readModule>",
      "packageUrl": "https://example.org/project-guide-1.0.0.json"
    }
  ]
}
```

`category` accepts `"workflow"`, `"interface"`, or `"platform"`, and `manifest` is validated against the standard module manifest schema. Module names must be unique within a single catalog; distinct publishers may list the same module name across different catalogs, though only one package of a given name can be installed in a project at a time.

## Publishing a Package

Each `packageUrl` serves a JSON bundle mapping relative module paths to base64-encoded file bytes:

```json
{
  "schemaVersion": 1,
  "files": {
    ".flecten-module/module.json": "<base64 of the manifest file>",
    "instructions.md": "<base64 of instructions>"
  }
}
```

To package a module directory, call `readModule` from `src/modules/package.ts`, base64-encode each returned file (`Buffer.from(bytes).toString("base64")`), upload the JSON bundle to HTTPS hosting, and copy the exact `manifest` and `revision` returned by `readModule` into your catalog entry (arbitrary tarball hashes will fail verification). Bump both `version` and `revision` whenever any file changes. Publishing requires no changes to Flecten itself.

Network fetches enforce a 15-second per-request timeout, a 2 MiB cap on catalogs, a 45 MiB cap on package JSON payloads, and zero HTTP redirects. Decoded bundles must pass all `readModule` limits: max 32 MiB and 5,000 files, with no symlinks, special files, or `..` path traversal. Both the full-package SHA-256 `revision` and the embedded `manifest` must match the catalog entry byte-for-byte before anything is written to disk.

## Dependencies and Trust

`requires` resolves across the selected catalog's dependency graph while reusing dependencies already installed in the project. Dependency cycles or missing packages abort installation before disk writes. A single install operation is capped at 32 packages and 128 MiB: all packages are downloaded and verified first, and any write or config-save failure rolls back newly created directories without overwriting existing modules.

Every newly installed package starts disabled and untrusted until the user clicks **Trust this version** under **Installed**, and UI surfaces require a separate **Use module interface** opt-in. Packages never auto-update, and attempting to install a duplicate module name fails cleanly. SHA-256 `revision` verifies byte integrity against the catalog entry; publisher authenticity follows trust in the catalog HTTPS origin.

## Application Contract

The `modules.marketplace` sidecar command accepts `action: "list" | "install" | "addSource" | "removeSource"`. `install` takes `source`, `name`, and the inspected `revision`, returning updated `moduleMarketplace` and `moduleState` snapshots. Shared schemas live in `shared/module-marketplace.ts`, UI state in `ui/src/lib/settings/modules.svelte.ts`, and components receive state via props while all filesystem and network I/O stays in the sidecar.

`tests/integration/module-marketplace.test.ts` covers the empty offline built-in catalog, preservation of installed modules, HTTPS catalog management, dependency resolution, trust gates, live agent activation, hash mismatches, path traversal rejection, and upstream failures. `tests/e2e/module-marketplace.spec.ts` covers empty states and catalog management in headless Electron with visual checks at `1480x940` and `1180x640`, while folder installs and trust flows are covered in `tests/e2e/modules.spec.ts`.
