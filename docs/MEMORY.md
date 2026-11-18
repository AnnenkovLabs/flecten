# Agent Memory

Project memory persists user preferences, corrections, and hard-won lessons across chats within the same project. The primary model decides what to save, read, update, and forget directly during normal turns; the host neither runs a background fact-extractor after every message nor asks users to curate a memory bank manually.

## What Gets Stored

Built-in kinds: `preference`, `lesson`, `decision`, `commitment`, `context`, and `procedure`. Custom kinds (such as `reference` or `deployment-caveat`) are also accepted: up to 64 characters matching `^[a-z][a-z0-9_-]*$`.

Each entry records a `kind`, canonical `key`, short `summary`, actionable future `content`, persistence `reason`, `priority`, and optional absolute `expiresAt`. Search `cues` are optional (default `[]`). Optional `topics` hold up to three descriptive navigation tags, and `appliesWhen` states the observable trigger condition shown in the index. `kind` captures knowledge shape while `topics` drive retrieval. Each `key` should represent one coherent topic or failure root cause; updates reuse the same `key` with the current `expectedRevision`.

A `lesson` must state what the agent misunderstood, which correction exposed it, and what to do in comparable situations. The model must not record speculative user wishes as facts or copy transient task progress, tool logs, code facts, or active project instructions into memory. Most ordinary runs produce zero memory writes.

Runtime validation enforces provenance rather than semantic truth: `preference` and `lesson` require a verbatim user quote, whereas other kinds (including custom kinds) accept user or tool evidence. Choosing an appropriate `kind` and drawing sound conclusions remain the model's responsibility.

## Lifecycle

1. `src/app/memory.ts` instantiates one project-scoped `MemoryStore` and injects it into sessions via `MemoryPort`; `core` never imports `store`.
2. `MemoryRuntime` binds to the session, message history, and system instructions. Before every standard provider request, it reloads active entries and computes a bounded delta.
3. The delta is appended after conversation history as a dedicated context message carrying `memoryReferences`, marked as historical data subordinate to current user and project instructions. The system prompt prefix is never rebuilt from memory contents.
4. The model reads full bodies via `memory`, saves verified corrections during regular turns, and may finish without writing anything. There is no post-run finalizer, background observer, or extraction timer.
5. Before compaction, the existing `PageWriter` may emit up to three `memoryCandidates` alongside its summary in the same model call, avoiding extra requests.
6. `done` accepts up to three optional `memoryCandidates` and commits them atomically with run completion without an extra turn. If an optional memory candidate fails validation or policy checks, `done` reports that failure in the tool result without aborting task completion. Native write policy is checked without opening hidden approval prompts.

Raw user input and memory context stay strictly separated. Standard user prompts and `steer` inputs preserve verbatim `memorySource` authority even when working text is translated. Hooks, runtime notices, summaries, internal prompts, Worker assignments, and `memory` tool outputs themselves never qualify as user-quote evidence, preventing self-confirming entries.

## Retrieval and Deduplication

Before each turn, delivery prioritizes pending invalidations first, then a compact topic catalog, then unseen entries. Topics are assigned by the model at write time rather than inferred by keyword heuristics in host code. The model browses relevant topics via `list(topic)` and batch-reads full bodies via `read`, keeping older entries reachable regardless of age or phrasing. `topics` paginates the topic catalog explicitly, while untagged entries appear under `Uncategorized`.

Within remaining discovery budget, `normal` entries arrive as index lines, whereas `critical` entries include their full body if space permits (falling back to an index line otherwise). Ordering: `critical` before `normal`, then most recently updated, then stable ID. Host code performs no semantic ranking. Topic-catalog snapshots carry a content-derived reference (`catalog:<SHA-256>`) so subsequent turns do not re-send unchanged catalogs unless clipping or compaction drops them from view.

Delivered entries track `{ id, revision, level }` (`index`, `full`, or `invalidated`). Calling `read` on an already fully visible revision returns a short confirmation instead of duplicating the body; an `index` line does not count as `full`. Output clipping and compaction clear visibility markers for evicted messages while retaining them for kept messages. Durable events and replay tie references to actual context messages rather than a permanent "seen once" flag.

Auto-delivery also skips an entry when full digests of all its evidence sources are already present in active history, or when its entire `content` appears verbatim in the system prompt. Partial source overlap does not suppress delivery. At save time, verbatim duplication of full `content` from the system prompt is rejected, whereas quoting a phrase that also happens to appear in the system prompt is allowed.

When an entry changes revision, expires, or is forgotten, the runtime strips stale memory messages from the next provider request projection and appends a brief invalidation notice. This works even during bulk revocations exceeding the 16-entry discovery cap or when discovery budget is full. Stripping removes the entire message containing a stale body, making any unaffected entries from that mixed message eligible for fresh delivery. Typed invalidation references persist in durable `memory.context` events so replay reproduces message removal while leaving raw tool events and transcripts intact. Material dropped due to budget limits never receives a `full` read marker. Tokens already processed by an upstream provider in earlier turns cannot be retroactively erased, so the model must re-evaluate prior assumptions after an invalidation notice.

## The `memory` Tool

| Operation | Contract |
|---|---|
| `topics` | Paginated active verified memory topics, up to 12 per page, optional `cursor`. |
| `list` | Paginated active non-expired entries, up to 12 per page. Optional exact `topic`, `kind`, literal `query`, and `cursor`; returns next cursor explicitly. |
| `read` | Single `id` or `ids` array (up to 6). Returns bodies with reason, source scope, quotes, and revision. Multi-ID reads cap combined bodies at 6,000 estimated tokens and list deferred IDs explicitly; single-ID reads use the standard tool-output cap. Forgotten and expired entries cannot be read. |
| `sources` | Up to 12 recent eligible conversation sources with role, reference, SHA-256 digest, and text excerpt. |
| `save` | Creates (`expectedRevision: 0`) or updates (current `expectedRevision`) a single `key`. Requires `evidence` and `reason`; `cues` default to `[]`. |
| `forget` | Takes `id` and `expectedRevision`; writes a tombstone revision and removes the entry from active recall. |
| `reconcile` | Applies up to 8 `save` and 8 `forget` operations in one atomic commit after validating all sources, revisions, and duplicate keys/targets. Retiring obsolete entries can free capacity for new ones in the same commit. |

`list.query` performs a literal substring match after Unicode NFKC normalization and case folding across `key`, `summary`, and `cues` (excluding full `content`); omitting `query` lists the catalog. Cross-language and semantic navigation happens through model-chosen `topics` rather than embeddings or lexical scoring. `topic` matches exact strings, and `kind` follows entry kind validation.

`sources` previews up to 2,400 characters per source, while evidence quotes must be 8-1,200 characters copied verbatim from an eligible session source of matching role. The runtime populates `sessionId`, `reference` (`user:<position>` or `toolCallId`), and full-message SHA-256 digest automatically; the model cannot fabricate arbitrary file paths or cite its own assistant turns as evidence.

Known secrets and recognizable credential formats in memory candidates are rejected before commit, and the store applies secret redaction again prior to disk write.

## Scope, Permissions, and UI

**Settings > Memory & Dictionary** displays public and local term definitions. Local `DictionaryEntry` records live inside `.flecten/memory.json` with `kind: "vocabulary"`, `key: "dictionary/<id>"`, and structured field `dictionary`, sharing the same evidence, revisions, and audit history. Vocabulary entries are excluded from general memory auto-discovery because the dictionary matcher injects relevant definitions before provider calls; they can be edited via the UI form or `memory save` with `dictionary`. Public categories, matching rules, and sync are covered in [DICTIONARY.md](DICTIONARY.md).

The memory bank resides at `.flecten/memory.json` under the canonical workspace root and is shared across concurrent sessions of that project, with no implicit user-global bank or cross-project reads. Shell `cd` commands do not alter bank identity; distinct canonical worktrees get separate banks while symlinks to the same root resolve to the same file.

Standard sessions and Talker/Worker pass memory through session options (Worker assignments never count as user-quote evidence). General child subagents receive a read-only `MemoryPort` when the parent has memory enabled: tool schemas block write operations, auto-delivery honors `read` policy, and new findings return to the parent model.

Native `SandboxPolicy.checkMemory` enforces fixed-path access and user deny rules while permitting internal metadata writes; `.flecten` remains protected against generic file tools. Auto-delivery and compaction checkpoints check policy silently and skip execution on `ask` or `deny`.

At the tool boundary, `topics`, `list`, `read`, and `sources` map to permission action `read`, while `save`, `forget`, and `reconcile` map to `write` on `.flecten/memory.json`, honoring active permissions and hooks. Native compaction checkpoints and `done.memoryCandidates` check write policy without triggering interactive approvals.

Memory operations, saved payloads, and errors appear directly in the session transcript; the status-bar entry count is diagnostic only and does not prove model compliance.

## Storage, Revisions, and Fault Tolerance

Storage format `version: 2` holds active `records` alongside `history` revision snapshots. Each record carries a stable `id`/`key`, `revision`, `status`, `createdAt`/`updatedAt`, and `evidence`. Saving an identical payload to an active `key` returns the existing record idempotently without bumping `revision` or rewriting the file.

Updates and `forget` use compare-and-swap (`expectedRevision`), returning a conflict error on stale revisions so the model re-reads first. `reconcile`, checkpoints, and `done` validate capacity upfront and publish atomically. Operations targeting the same canonical path serialize through an in-process mutex and write via `atomicWrite` with mode `0600`, backed by `sidecar.lock` ensuring one sidecar per project (external out-of-band file edits are not covered by the in-process mutex).

Unchanged files skip reparsing via a validated metadata cache (`dev`, `inode`, `mtime`, `ctime`, `size`). Modified files read and validate from a single file descriptor; corruption detected after cache warmup fails explicitly rather than serving a stale snapshot. Commits invalidate the cache immediately.

A missing `.flecten/memory.json` represents an empty bank. Malformed JSON, unknown schema versions, non-regular files, or oversized files raise explicit errors without overwriting the damaged file with an empty bank; the runtime reports memory unavailable and deduplicates repeated unavailable notices until state changes.

`forget` is logical: tombstones, `history`, and raw session transcripts retain prior text, and forgetting an already forgotten entry is a no-op. Audit history is never auto-purged.

Legacy `version: 1` files migrate on first read: IDs and timestamps carry over, `kind` becomes `"context"`, `key` becomes `"legacy/<digest>"`, and `evidence` is marked `role: "legacy"` (unverified). Migrated records remain readable via `list`/`read` but are excluded from auto-delivery until the model gathers fresh verified evidence and saves a new revision.

## Cost and Limits

| Boundary | Limit |
|---|---|
| Auto-delivery budget | Up to 1,200 estimated tokens across visible automatic memory messages, further bounded by remaining context headroom |
| Single delta | Up to 16 reference entries (header reserved); invalidations budget separately from discovery |
| Bulk withdrawal | Short notice plus up to 5,000 typed record references outside model-facing prose; stale bodies removed before request |
| `list` / `topics` page size | Up to 12 entries |
| Compaction / `done` checkpoint | Up to 3 candidates piggybacked on the existing summary or completion |
| Tool candidate sizes | `summary` <= 160 chars, `content` <= 1,600, `reason` <= 500, up to 8 `cues` of <= 80 chars |
| Candidate evidence | 1-4 verbatim quotes, 8-1,200 chars each |
| Active records | Up to 500, with no silent eviction |
| `records` and `history` arrays | Up to 5,000 items each |
| File size | Up to 32 MiB, checked before read and before write |

Auto-delivery tokens are estimated with `PROFILE_4` (not exact provider billing counts), reserving output tokens plus a 160-token safety margin before each request. Explicit `list`/`read` calls consume standard tool-output budget rather than auto-discovery quota.

The underlying store accepts wider fields for migrations and internal APIs (`summary` <= 300, `content` <= 8,000, `reason` <= 2,000, up to 16 `cues`, up to 12 `sources`) without relaxing tool input schemas. Expired entries stop appearing in recall but count toward the 500 active-record cap until forgotten. Exceeding record, history, or file-size caps rejects the commit.

Memory introduces zero extra model or embeddings requests; token cost comes from system instructions, the `memory` schema, bounded discovery deltas, explicit `memory` calls, and optional candidates in compaction/`done`.

Compaction checkpoints are skipped on deterministic fallback, invalid summaries, or non-model compaction. If checkpoint candidates fail validation or persistence, the valid compaction summary still commits and the runtime records a diagnostic notice (written immediately to context and durable `memory.context` during idle/manual compaction, or delivered before the next turn during an active loop). Checkpoint candidate batches are all-or-nothing, with no extra retries or forced continuation turns.

`ponytail:` the curated store targets up to 500 active entries. Topic catalogs and batch reads lower navigation overhead, though hundreds of fine-grained topics can still misroute model selection. There is no automatic semantic deduplication, hidden importance scoring, knowledge graph, background extractor, user-global bank, or external search index; the primary model merges duplicates via `reconcile`. If measured recall misses justify it later, candidate retrieval can be layered on while preserving source authority, CAS revisions, token budgets, and exact context tracking.

## Implementation and Tests

- `src/core/memory/runtime.ts`, `delivery.ts`, `sources.ts`, `command.ts`, `schema.ts`, `context.ts`: tool execution, evidence checks, limits, and visibility tracking.
- `src/store/memory.ts`, `src/app/memory.ts`: durable storage, CAS, v1 migration, and shared project port.
- `src/core/loop/stream.ts`, `context.ts`, `tool-message.ts`, `src/core/session/session.ts`: delta injection and loop integration.
- `src/core/pages/writer.ts`, `prompts/memory-checkpoint.md`: piggybacked compaction checkpoint.
- `src/store/events/replay.ts`: reconstruction of source and reference metadata on reopen.
- `tests/unit/memory-store.test.ts`, `memory-runtime.test.ts`, `page-memory-checkpoint.test.ts`: store invariants and full session/run paths with scripted providers.
- `tests/unit/memory-navigation.test.ts`, `memory-completion.test.ts`, `memory-withdrawal.test.ts`: topics, batch reads, `done` capture, and bulk invalidation before requests and across replay.

Automated suites prove deterministic boundaries and delivery mechanics against scripted responses rather than live-model recall quality or cost savings; live-model smoke results are tracked separately in internal engineering notes.
