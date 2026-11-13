# Security

[English](SECURITY.md) · [简体中文](docs/i18n/SECURITY.zh-Hans.md) · [Português (Brasil)](docs/i18n/SECURITY.pt-BR.md) · [Español](docs/i18n/SECURITY.es.md) · [日本語](docs/i18n/SECURITY.ja.md) · [Українська](docs/i18n/SECURITY.uk.md) · [Русский](docs/i18n/SECURITY.ru.md)

## Supported versions

Only the `main` branch is supported.

## How to report

Do not open a public issue for a vulnerability. Use a private GitHub security advisory or write to the repository owner. Include the version, reproduction steps, and the potential impact.

Expect a response within 7 days. The fix and the disclosure of details are coordinated with the reporter.

## What to check first

- path traversal in the `liquid://` protocol;
- the `preload` bridge and access to `ipcRenderer`;
- `contextIsolation`, `sandbox`, and `nodeIntegration` in the window;
- CSP and loading of external resources;
- redaction of tokens from logs and `events.jsonl`;
- `bash` commands and writing files outside the allowed set;
- launching MCP servers and hooks from `flecten.config.json`;
- passing the environment to child MCP processes;
- instruction injection through `SKILL.md` and MCP responses.

The architectural security boundaries are described in [docs/SECURITY.md](docs/SECURITY.md).
