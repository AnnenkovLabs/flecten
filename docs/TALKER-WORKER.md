# Talker and Worker

New chats run the dual-role **Talker + Worker** architecture by default, controlled by **Separate conversation from execution** under **Settings > Models** (toggling applies to newly created chats). Talker converses directly in the user's language, loads skills, answers questions or streams interim Markdown updates during execution, and renders an HTML `<summary>` exclusively for the final accepted task deliverable, eliminating separate translation calls. Worker receives structured assignments, executes tools, and reports results in plain Markdown.

**Settings > Models** configures the primary model (used in single-agent chats), dedicated **Talker** and **Worker** overrides, per-subagent-role models, and the **Vision** fallback model. In dual-role chats, the composer model picker sets Worker for that chat while Talker uses its configured model; an unset Worker inherits the primary model, and an unset Talker inherits Worker. Subagents resolve role-specific overrides first, then their agent definition, then the caller's model; Vision runs only when the active model lacks native image input.

Splitting roles isolates verbose tool context from user conversation rather than guaranteeing lower spend on short tasks: both loops consume tokens, tracked on separate **Talker** and **Worker** lines in context details (the top-level context indicator reflects Talker).

Each row in **Settings > Models** exposes its own `reasoning` selector populated from model metadata (boolean thinking toggle where applicable, disabled when unsupported). Changing reasoning on an inherited Talker or Worker row promotes the resolved model into an explicit role setting; resetting restores inheritance alongside reasoning and variant defaults. When left unset, Talker and Vision send requests without reasoning rather than inheriting an expensive Worker thinking budget, whereas primary, Worker, and subagent runs use the model/provider default. Vision maintains its own pricing and cache key independent of Worker settings.

## Conversing During Execution

Talker acts as a semantic compiler (resolving user slang, shorthand, and implicit references through the term dictionary, project memory, and conversation history) and coordinates Worker through the five-operation `worker` tool:

| Operation | Argument | Behavior |
|---|---|---|
| `start` | `task` or `assignment` | Launches an asynchronous Worker run with a dense compiled English brief (`task`, focused on taste, user intent, and the real end result rather than verification checklists) or structured `assignment` and returns control to Talker immediately while preserving the latest raw user quote in `userConstraints`. |
| `steer` | `message` | Delivers updated guidance at Worker's next safe turn boundary without interrupting an in-flight command. |
| `resume` | none | Resumes an unfinished assignment with preserved criteria and blockers after re-checking workspace state. |
| `status` | none | Returns current Worker phase and latest result summary without dumping raw logs. |
| `stop` | none | Cancels Worker immediately via its `AbortSignal`. |

At most one Worker runs per chat at a time (calling `start` while active is rejected in favor of `steer`). Talker has read/search tools and `skill` access, delegating all file mutations and shell execution to Worker (which enforces project instructions, permissions, sandboxing, and gates; Talker explicitly embeds any needed skill instructions into the brief).

## Assignments and Runtime Acceptance

`task` provides a direct, zero-ceremony compiled brief (automatically preserving the user's latest verbatim quote in `userConstraints`), while `assignment` works uniformly across coding, research, writing, math, media, and desktop tasks when distinct `acceptanceCriteria` (`"tool_result"` or `"model_assertion"`), `expectedOutputs`, or step boundaries add clarity.

Runtime acceptance automatically binds observed successful tool results from the current revision to open criteria on Worker completion, while rejecting completion when a `"tool_result"` criterion has no successful tool execution in the active revision. Worker can also call `criterion` explicitly to inspect criteria, bind a specific tool call ID, or mark an item `blocked` (with cause and required next action). User steering or Twin `revise` feedback bumps `revision` and reopens criteria so stale evidence from a superseded direction no longer counts. Acceptance state persists via `worker.acceptance` events and blocks Talker from emitting a final completion summary while Worker or Twin review is still running or while criteria remain `open`/`blocked` (Talker may still report status in plain Markdown).

For modules, tool schemas restrict Talker to `list`, `status`, `tools`, and `read`, reserving `activate`, `call`, and `deactivate` for Worker while binding both roles and the **Computer** workspace tab to the same shared module instance (human Computer previews use a separate observation ID at one in-flight refresh at a time so they never overwrite Worker's action observation ID).

Users can message Talker mid-stream: **Send** steers Talker at the next step boundary while Worker keeps running uninterrupted, **Queue** holds the prompt for a subsequent run, **Stop Worker** aborts only Worker, global **Stop** halts both loops, and per-card cancel targets that individual tool call.

Worker can call `ask_talker` (a single tool-free call to Talker's model with recent dialogue context, billed to the shared chat ledger) to clarify already stated user intent, or `ask` when genuine new user input is required. Each Talker turn occupies its own chronological slot between Worker tool cards without overwriting earlier commentary (`message.started` anchors position even if Worker starts another call mid-stream, and adjacent tool cards stack tightly while preserving 40 px hit targets).

## Live Tool Cards (`[[w_<uuid>]]`)

Every Worker tool call receives a random chat-scoped ID (`w_<uuid>`). Talker can embed live interactive cards directly in Markdown prose (outside code spans, URLs, and `<summary>` HTML):

```text
Running verification checks:

[[w_example_id]]
```

Every Worker call renders automatically in the thread as soon as `worker.event` arrives, so fast calls between Talker turns are never hidden; if Talker explicitly references `[[w_<uuid>]]`, that reference claims the card's slot without duplicating it, while unknown IDs remain plain text.

The **Worker Actions** workspace tab (alongside Changes, History, and Terminal, supporting split-pane layout, scroll preservation, and dedicated **Stop Worker**) projects the exact same underlying `worker.event` stream, streaming live redacted `bash`/PTY output without polling any model.

Worker progress notifications to Talker coalesce to at most one automatic wake-up every 15 seconds (completion delivers immediately), passing status, call ID, and up to 8,000 characters of untrusted output while keeping raw logs out of Talker's context window and preserving the user's raw prompt history untouched.

## Persistence and Crash Recovery

Talker and Worker serialize writes through one shared conversation event queue in exact real-time arrival order, wrapping Worker events inside parent `worker.event` envelopes so reopening restores identical card IDs and rebuilds Worker's context independently of Talker's chat transcript. `session.started.role` pins chat architecture at creation time (`conversation.enabled: false` preserves single-agent mode for new chats while existing chats keep their original loop). After an unexpected crash, an unfinished Worker run is marked interrupted and never replays shell commands blindly on `resume`.

## Verification

Covered by `tests/integration/conversation.test.ts` (concurrent chat during live shell execution, steering, card cancellation, stop, replay), `tests/integration/conversation-modules.test.ts` (shared Computer runtime, takeover, stop, Talker schema restriction), `tests/unit/worker-mirrors.test.ts` (reference parsing and event projection), and `tests/e2e/conversation.spec.ts` (settings, sidecar, live output streaming, mirrored cards, and session reopen in headless Electron at `1480x940` and `1180x640`).

## Worker Context Pages

Worker uses `context` (`op: "compact"` or `"complete"`, plus archive `list`, `read`, `search`) to compact completed logical blocks at natural boundaries without mandatory page-opening ceremony: `compact` archives the full segment to `.flecten/sessions/<chat>_worker/pages/` and replaces active history with its structured summary immediately, even when context utilization is low. Short single-block tasks can complete directly without an extra compaction round-trip. When blocked by an external dependency, `context block` records cause, evidence, and next action, returning a blocker report to Talker so the next run resumes cleanly.
