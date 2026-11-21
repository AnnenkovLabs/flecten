# Execution Contracts (Post-Physicss Audit)

Changes landed on November 16, 2026 eliminate state loss and redundant model calls. Contract suites run against local protocol fixtures, the real Bun runtime, and headless Electron; they do not certify external relays, historical binaries, or cloud VM images.

## Provider Stream

OpenAI Chat validates stream chunks, terminal markers, and reported finish reasons. Once an explicit `[DONE]` sentinel arrives, a missing `finish_reason` is accepted: accumulated text completes the turn, and complete schema-valid tool calls continue the tool loop. A stream that closes without `[DONE]` is treated as a dropped connection. Malformed JSON, unrecognized payloads, empty responses, and truncated tool calls produce distinct failure reasons. Truncated tool-argument JSON is never executed. Finish reason `length` preserves the configured `max_tokens` context.

`provider.response` records a redacted receipt: protocol, request identity, raw finish reason, parse counters, usage presence, and duration. Operational diagnostics retain retry metadata and nested lifecycle events. Model text, credentials, and prompts are excluded from receipts. The 15 historical empty responses observed before this audit cannot be attributed retroactively without raw upstream payloads.

The provider registry attaches an attempt ID and the actual pre-failover `provider`/`model` to each receipt. Failed primary attempts are never priced at the winning fallback route's rates. Local rejections triggered by an active quota cooldown record `requested: false`. Intra-attempt HTTP retries currently roll up into a single receipt, so `missingRequests` counts attempts lacking usage rather than raw HTTP round-trips.

`model_quota_exhausted` uses a dedicated model-quota cooldown class. Multiple handles targeting the same `provider`/`model` share cooldown state. Explicit `models.<id>.quotaGroup` links aliases that draw from a shared upstream quota while leaving unrelated groups available; quota groups come from explicit config rather than model-name heuristics. Credential updates clear stale quota state.

## Working Context and Deliverables

The provider context window remains a hard ceiling, while active working sets target 32,000 tokens for Talker and 96,000 tokens for Worker (output reserve and system/tool schemas are budgeted separately). Talker defaults to `reasoning: "none"` unless an explicit reasoning level is configured.

Routine tool events stream directly to the UI. Worker errors do not spin up a Talker turn merely to narrate the failure. Successful Worker runs pass through acceptance and produce a single substantive Talker response.

`context` (`op: "compact"` or `"complete"`) records structured `findings`, `risks`, `result`, and `finalResult`. Full reports and transcripts are archived before active history is replaced. A populated `finalResult` completes atomically once acceptance criteria pass. Structured page checkpoints require no extra model summarizer call, and recovery can read evidence and archived pages without opening a synthetic working page.

Worker tasks carry either a dense compiled brief (`task`) or structured `assignment` (current step, open questions, source boundaries, `expectedOutputs`, and sufficiency criteria), while raw user speech is stored verbatim alongside. Criteria requiring `tool_result` evidence can only be satisfied by an observed successful tool call in that assignment (automatically bound by the runtime on completion or reported explicitly via `criterion`).

## Chat Accounting

A single task ledger tracks spend across the entire chat, including continuations and restarts. Primary turns, Talker, Worker, subagents, report formatting, Twin, vision descriptions, translation, and compaction all accumulate into one total, while each run keeps its own wall-clock timer.

`usage` denotes a verified provider billing receipt; `usage.unavailable` marks any request lacking usage data, including failed calls. Partial spend is never rendered as zero: known spend acts as a lower bound and can still trip configured budget caps, while unbilled requests prevent guaranteeing an exact monetary ceiling.

Durable `task.budget` snapshots flush whenever the ledger advances, and trailing `usage` events after the latest snapshot replay exactly once. Historical sessions without stored billing receipts may reflect current config pricing on replay.

Twin records per-route charges and missing-receipt counts separately so a succeeding fallback never masks uncertainty from a prior attempt; subagent report formatting uses the same route ledger. Local quota-cooldown rejections add zero unknown spend, keeping live and replayed totals identical.

## Files, Permissions, and Remote Operations

Session scratch lives at `.flecten-scratch/<sessionId>`, persists across individual shell invocations, and is exposed via `TMPDIR`. Long-line file cursors advance by UTF-8 code points without splitting multibyte characters. Root directory overviews and `glob` pagination map large repositories without forcing full traversal of asset or cache trees.

Session permission grants bind to session owner, exact resource scope, and policy fingerprint. Replay restores them within that session without escalating to global rules or overriding a newer explicit `deny`.

Remote jobs persist a stable handle before submission. The detached remote runner records PID/start identity, stdout/stderr streams, and an atomic exit record. A dropped SSH connection leaves the operation indeterminate and inspectable via `status` on the same handle; resubmitting the same `id` and `argv` is idempotent.

SSH preflight checks verify a live agent socket and a trusted host key. Only the agent socket and a scoped public `known_hosts` file enter the sandbox; private keys and the rest of `~/.ssh` stay unmounted. Remote command strings remain opaque to local path analyzers.

Shell tool success reflects process exit status, while `expectedOutputs` separately verifies regular-file existence, minimum byte size, and optional SHA-256 digests. Exit code `0` and verified output artifacts are reported distinctly.

## Verification

Contract regressions are covered in `tests/unit/chat-stream-contract.test.ts`, `page-deliverables.test.ts`, `harness-tool-contracts.test.ts`, `ssh-capability.test.ts`, `remote-jobs.test.ts`, and `tests/integration/task-accounting.test.ts`. `tests/e2e/task-accounting.spec.ts` verifies unknown-spend UI states at `1480x940` and `1180x640`.

`tests/integration/provider-accounting.test.ts` exercises failover accounting over a real local HTTP server. `tests/integration/mcp-discovery-service.test.ts` exercises `AppService`, Streamable HTTP MCP, lazy schema activation, model switching, replay, and compaction: the model receives MCP tool names and descriptions upfront, while full JSON Schemas load after `tool_catalog activate` and persist across chat turns.

In the Physicss benchmark artifact, the dataset manifest and `3d/REPRODUCIBILITY.md` tie source frames, masks, COLMAP views, and runtime metadata together; historical `rembg` weights/versions, immutable cloud VM images, and unavailable external 2DGS build sources remain external reproducibility constraints.
