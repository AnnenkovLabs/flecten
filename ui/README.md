# UI

Svelte 5 and Vite frontend. Renders state and dispatches user actions; never reads files, calls models, or owns canonical session persistence.

## Commands

```bash
bun run dev:ui     # browser dev server
bun run app:dev    # Electron + Vite
bun run build:ui   # production build to ui/dist
```

## Rules

- Components receive screen data via props from top-level view containers.
- Sidecar events flow through `src/lib/desktop.ts` and `run.svelte.ts`.
- Components never read files or call models.
- Design tokens, font declarations, and base styles live exclusively in `src/app.css`.
- Components never import `shell` or depend directly on Electron APIs.
- Interactive controls must be keyboard-accessible with accessible names and visible focus states.
- `prefers-reduced-motion` renders immediate static states.
- Every new dependency requires an entry in the decision log.

## Layout

```text
src/
  main.ts                 entry point
  App.svelte              window state and keyboard shortcuts
  app.css                 tokens, fonts, base styles
  assets/fonts/           Manrope font files and license
  lib/
    types.ts              UI view-model types
    icons.ts              Hugeicons name map
    agent.ts              tool, diff, and terminal mappers
    run-machine.ts        pure run-phase state machine
    run.svelte.ts         thread state, sidecar events, context usage
    motion.ts             expand, enter, and reduced-motion helpers
    media.svelte.ts       reactive prefers-reduced-motion media query
    toast.svelte.ts       transient notifications
    format.ts             pluralization and formatting helpers
    desktop.ts            Electron preload bridge client
    platform.ts           Ctrl vs Cmd modifier detection
  components/
    TitleBar.svelte
    Sidebar.svelte
    ProjectGroup.svelte
    TaskRow.svelte
    MainPane.svelte
    MainHeader.svelte
    SessionState.svelte
    Thread.svelte
    UserMessage.svelte
    RunGroup.svelte
    FileChangeChip.svelte
    FileTypeBadge.svelte
    Answer.svelte
    LiveRun.svelte
    LiveGlow.svelte
    Composer.svelte
    ComposerBar.svelte
    InspectorPanel.svelte
    ChangesPane.svelte
    DiffFile.svelte
    ChecksPane.svelte
    CheckRow.svelte
    TerminalPane.svelte
    Toast.svelte
    Icon.svelte
    MorphIcon.svelte
    GooFilters.svelte
```

## Data Flow

1. `App.svelte` owns panel visibility, active workspace tab, and `RunStore`.
2. `Composer` submits prompts via `RunStore.start`.
3. `Thread` renders user messages, run activity summaries, and live run status.
4. `InspectorPanel` renders file diffs, checks, and terminal output derived from tool events.
5. `LiveGlow` mounts only during an active run and halts `requestAnimationFrame` when off-screen or under `prefers-reduced-motion`.

## Adding a Component

Create the component in `src/components`, declare props with `$props()`, and keep styles scoped in `<style>`. Pass screen-level state down from `App.svelte` or `MainPane.svelte`; leaf components never import core or global runtime stores directly.

## Verification

```bash
bun run check
bun run lint
bun run build:ui
```

Inspect visual changes at 1480x940 and 1180x640, including under `prefers-reduced-motion: reduce`.
