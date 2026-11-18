# Shell

Electron 45 desktop shell: window lifecycle, preload bridge, custom protocol, and sidecar process management.

## Commands

```bash
bun run app:dev   # Vite + Electron
bun run app       # build UI and launch Electron
bun run app:shot  # capture window screenshot to a temp file
```

## Layout

```text
main.mjs      window lifecycle, flecten:// protocol, IPC, sidecar spawn, screenshots
preload.cjs   sole window.desktop bridge for window controls and agent commands
```

## UI Loading

- In dev, the window loads `FLECTEN_DEV_URL` from Vite.
- In production, the window loads `flecten://app/index.html`.
- The custom protocol serves files strictly inside `ui/dist`; path traversal returns 404.
- Responses read via `readFile`, working transparently inside packaged `asar` archives.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `preload.cjs` exposes only `control(action)`, `agent.send(command)`, and `agent.onEvent(listener)`.
- The main process validates every window action and command type against an explicit allowlist.
- Core runs as a separate Bun sidecar process with no access to Electron APIs.
- Popups and external navigation outside the app are blocked.
- Content Security Policy is enforced in `ui/index.html`.

## Boundaries

The shell manages the OS window, static UI assets, and the sidecar process. It knows nothing about Twin, tools, context budgets, or pages. Any harness logic inside `main.mjs` is a boundary violation.

In dev, the sidecar starts via `bun run src/app/server.ts`. Packaged builds execute `resources/flecten-agent` with prompts loaded from `resources/prompts`.

Electrobun remains the long-term production shell target per ADR-003; Electron serves as the shipping shell packaged via `electron-builder.yml`.
