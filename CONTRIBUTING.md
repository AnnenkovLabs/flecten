# Contributing

[English](CONTRIBUTING.md) · [简体中文](docs/i18n/CONTRIBUTING.zh-Hans.md) · [Português (Brasil)](docs/i18n/CONTRIBUTING.pt-BR.md) · [Español](docs/i18n/CONTRIBUTING.es.md) · [日本語](docs/i18n/CONTRIBUTING.ja.md) · [Українська](docs/i18n/CONTRIBUTING.uk.md) · [Русский](docs/i18n/CONTRIBUTING.ru.md)

## Setup

You need Bun 1.4 and Node 20 or newer. Node is only required for Electron.

```bash
bun install
bun run dev help
bun run app:dev
```

## Before a PR

Run all checks:

```bash
bun test
bun run check
bun run lint
bun run build:ui
```

If you changed the window, attach a screenshot or describe a browser check at 1480x940 and 1180x640. Check the states: empty, loading, stopped, reduced motion.

## Code rules

- One file owns one thing. Soft limit 300 lines, hard limit 500.
- `core` does not import `ui`, `shell`, or `store`.
- The interface does not read files or call models.
- Data from the model, files, and the web is validated by a schema at the boundary.
- The core does not write to `console`. Events go through the bus.
- Prompts live in `prompts/`, not in code.
- Secrets are redacted before anything is written to a log.
- A comment explains the reason, not the action.
- A temporary simplification is marked `ponytail:` with its limit and a path forward.

## Interface

- Read `design.md` before changing visual behavior.
- Components live in `ui/src/components`, state and pure functions in `ui/src/lib`.
- Demo data changes only in `ui/src/lib/demo.ts`. A component does not keep a copy of that data.
- Tokens, fonts, and base styles live in `ui/src/app.css`. Do not add a second set of tokens.
- A new component receives data through props. A direct import of `demo.ts` is allowed only in screen containers.
- Interactive elements work from the keyboard and have an `aria-label` or a visible label.
- Animation is not required to understand state. `prefers-reduced-motion` must leave a static frame.

## Dependencies

A new dependency requires a decision record: context, decision, consequences. Check the Bun standard library first, then a package.

## Commits

One commit is one change of meaning. Message in the imperative: `add spec parsing`, `fix page boundary`. Secrets and `.liquid/` are never committed.

## Behavior

Discuss code and decisions, not people. Insults, harassment, and publishing others' data are unacceptable. Report a problem privately to the repository owner. See the [Code of Conduct](CODE_OF_CONDUCT.md).
