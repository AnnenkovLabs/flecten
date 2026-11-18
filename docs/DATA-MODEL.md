# Data Model

## Layout

```text
.flecten/
  sidecar.lock            core lock: PID, token, start timestamp
  secrets.json            API keys from settings, mode 0600
  memory.json             project memory
  checkpoints/            pre-image and post-image snapshots for /undo and /redo
  shadow/                 shadow Git repository for shell command snapshots
  todos/<sessionId>.json
  cache/                  model catalog
  trash/                  deleted tasks
  skills/                 project skills
  profile.json            planned
  terms.jsonl             planned
  sessions/
    index.json
    <sessionId>/
      spec.json
      events.jsonl
      queue.json          durable message queue across restarts
      pages/
        p1.md
        p2.md
      logs/
        <toolCallId>.log
```

Project state lives in `.flecten/`. Each session stores its spec, event log, message queue, context page handoffs, and full tool logs. State files are written atomically via a temporary file and rename. A single core process serves each project, coordinated by `sidecar.lock`; see [PROTOCOL.md](PROTOCOL.md).

Legacy `.liquid/` directories are migrated to `.flecten/` when a project is opened, preserving sessions, attachments, memory, and checkpoints. The legacy directory remains excluded from Git and protected from standard file tools.

## SQLite

Planned. The core currently stores everything in the filesystem layout above; `bun:sqlite` is not wired in.

```sql
sessions(id, raw, created_at, finished_at)
pages(id, session_id, criterion_id, title, handoff, created_at)
profile_entries(id, kind, text, source, weight, created_at)
terms(term, definition, source, updated_at)
```

`kind` accepts `preference`, `vocabulary`, `taste`, `anti_pattern`, `decision`.

`weight` increases when an entry is reconfirmed and decreases when the user overrides it.

## Events

`events.jsonl` is an append-only log with one `Event` JSON object per line and secrets redacted. The user's raw message is stored verbatim in `sessions.raw` and in the opening event.

## Profile

`profile.json` is a read snapshot. `profile_entries` is the source of truth for queries.

```json
{
  "preferences": [],
  "vocabulary": {},
  "taste": [],
  "antiPatterns": [],
  "decisions": []
}
```

## Terms

`terms.jsonl` stores one JSON record per line:

```json
{"term":"ai slop","definition":"...","source":"user","date":"2026-10-19"}
```

`source` accepts `user`, `kb`, `docs`, `web`. Entries with `source: "web"` without a `date` are ignored.

## Spec

`spec.json` is validated against `src/core/spec/schema.ts`. Acceptance criteria use stable IDs (`c1`, `c2`).

## Page Handoff

`pages/p1.md` contains four sections: `Changed`, `Invariants`, `Next`, `Risks`. Empty sections are preserved so lightweight validation can flag omissions.

## Logs

Full tool output is written to `logs/<toolCallId>.log`, while model context receives a truncated excerpt. Logs are excluded from Git; session deletion and retention are managed through history settings (see [PRIVACY.md](PRIVACY.md)).
