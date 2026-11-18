# Electron E2E Tests

End-to-end tests boot a real Electron main/renderer process, a real Bun sidecar, and a local mock provider. No network access or live API keys are required. The window is created hidden: the test fixture sets `FLECTEN_HEADLESS=1`, and `shell/main.mjs` skips `win.show()`.

## Running

```bash
bun install
bun run test:e2e
```

`test:e2e` builds `ui/dist` and `dist/flecten-agent`, then runs Playwright. `playwright install` is unnecessary because Playwright launches the Electron binary from `node_modules`.

Run directly without rebuilding:

```bash
bun run build:ui
bun run build:agent
bunx playwright test
```

Run a single test:

```bash
bunx playwright test tests/e2e/app.spec.ts -g "new session"
```

List tests without running:

```bash
bunx playwright test --list
```

## Architecture

- `playwright.config.ts`: single worker, serial execution, timeouts, failure traces, and screenshots.
- `tests/e2e/fixtures.ts`: isolated `FLECTEN_CWD`, isolated `FLECTEN_CONFIG`, `FLECTEN_HEADLESS=1`, mock provider server, Electron launch via `_electron.launch`, console error collection, and teardown. Windows never appear on screen or steal focus.
- `tests/e2e/app.spec.ts`: smoke flow, streaming skeleton, message queue, copyable code blocks, and Mermaid; verifies that the summary iframe loads from `flecten-summary://`, avoids `srcdoc`, never leaks raw `<summary>` markup, executes inline JS and tab switching, and opens files from the `read` card in the file viewer with `Esc` dismissal.
- `tests/e2e/html-interactions.spec.ts`: all four delivery modes for summary interactions, live mock-provider request verification, and snapshots at `1480x940` and `1180x640`.
- `tests/e2e/notices.spec.ts`: error banners stay pinned above the composer until dismissed while info notices auto-dismiss; a second window opened on the same project receives `project_locked` without restart-looping the sidecar.
- `tests/e2e/visual.spec.ts`: visual snapshots of a thread with tool calls and summary, settings, new-session screen, and empty state at `1480x940` and `1180x640`, plus `prefers-reduced-motion`. Snapshot update instructions live in `tests/e2e/README.md`.
- `tests/e2e/polish.visual.spec.ts`: post-send focus, message timestamps, thread search, scroll-to-bottom button, task rename and delete, and drop hint at `1180x640`; snapshots are written to the Playwright output directory.
- `tests/e2e/scrollbar-check.spec.ts`: asserts zero document-level scrolling at both `1480x940` and `1180x640` before and after runs; only inner panes scroll.
- `scripts/e2e-mock.mjs`: OpenAI Chat Completions SSE server. First turn requests `read README.md`; second turn streams Markdown plus `<summary>` HTML across multiple chunks to exercise incremental assembly. `E2E_MOCK_CALLS` (JSON array of `{ name, arguments }`) and `E2E_MOCK_REPLY` override tool calls and replies.
- `docs/E2E.md`: this document.

Each test gets a fresh temporary project directory with `README.md` and `flecten.config.json`, deleted after teardown. The test config disables the remote model catalog and OS sandbox for host-independent runs.

## Headless Linux

When both `DISPLAY` and `WAYLAND_DISPLAY` are unset, the test harness generates a temporary wrapper and launches Electron under `xvfb-run -a`. Install `xvfb` first:

```bash
sudo apt-get install -y xvfb
```

Tests skip with a diagnostic message if `xvfb-run` is unavailable on a headless host, or if Electron, `ui/dist`, or `shell/main.mjs` is missing.

## CI

GitHub Actions on Ubuntu:

```yaml
- run: bun install --frozen-lockfile
- run: bun run test:e2e
```

`xvfb` is preinstalled on `ubuntu-latest`. If the runner wraps commands in Xvfb directly:

```bash
xvfb-run -a bun run test:e2e
```

Tests must not run concurrently against the same X display; `playwright.config.ts` enforces `workers: 1`.

## HTML Summary and CSP

`HtmlSummary.svelte` never injects raw model documents into the app DOM. It mounts `<iframe src="flecten-summary://shell" sandbox="allow-scripts">` and streams content over `postMessage`: first a `config` message with theme tokens and fonts, then incremental HTML tokens, and finally `finish` to execute inline scripts. The UI stream parser strips `<summary>` blocks out of Markdown, renders a skeleton placeholder, and forwards only complete HTML tokens so raw markup never flashes.

The main process serves `flecten-summary://shell` from `shell/summary-runtime.js` with its own `Content-Security-Policy` header. Unlike `blob:` URLs and `srcdoc`, which inherit the parent window's CSP (and cannot relax it via `<meta>`), a custom protocol isolates the child CSP so inline runtime and model scripts run without weakening the main window's policy.

Isolation boundaries remain strict: `sandbox="allow-scripts"` without `allow-same-origin` gives the iframe an opaque origin with no access to parent DOM, files, secrets, or preload bridges. The child CSP blocks `connect-src` and nested frames. Height updates and user interactions cross back via `postMessage`, validated by `event.source` and message schema. Theme variables and Manrope font `data:` URLs arrive via the `config` message.

## Known Limits

- 12 tests across 5 spec files cover the new-session screen, tool calls, tool details, file viewer, HTML summary, streaming skeleton, queue, code blocks and Mermaid, notices, locked-project second window, visual snapshots, thread polish, and document scroll invariants. Approval deny, Allow All, and Deny All are covered in `tests/unit/session-pool.test.ts` rather than Electron; diff, undo, resume, and steering are covered by core unit tests.
- The mock server implements `openai-chat` only; other provider protocols are covered by unit tests.
- Visual snapshots cover the new-session view, empty state, settings, and summary thread at `1480x940` and `1180x640` plus reduced motion, masking timestamps, live spinners, durations, cost readouts, paths, and greetings.
- The UI avoids `data-testid`. Specs bind to stable IDs (`#new-session-prompt`, `#prompt`), accessible `aria-label` attributes (new session, message queue, stop, send), and semantic classes (`run-summary`, `action`, `detail-section`, `summary`, `live-run`). Renaming these selectors breaks E2E specs.
- Queued execution is asserted via queue tray appearance/disappearance, run-indicator completion, and summary rendering; the UI does not render dequeued items as separate user thread bubbles.
- Failure traces and screenshots are written to `.flecten/e2e-results/`.
