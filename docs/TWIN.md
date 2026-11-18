# Twin

Twin acts as the user's proxy in dialogue with Worker. Backed by a dedicated persona profile, Twin sits between Talker and Worker: setting direction, answering taste and trade-off questions, catching drift at stage boundaries, and sending work back for revision before a final report ever reaches Talker.

## Execution Loop

1. When Talker dispatches an assignment to Worker, Twin receives the user's raw messages plus active persona traits and addresses Worker in the first person.
2. Each successful `context complete` triggers a stage review before Worker's next turn (up to four stage checks per task).
3. Worker `ask` questions route to Twin first so Twin can pick the best-supported option; real security and filesystem approvals remain strictly in `PermissionEngine`.
4. Once Worker finishes, Twin audits the report, bounded tool calls/results, file-tool diffs, and up to two tool-returned images. Returning `revise` resumes the same Worker session (up to four revision rounds per task).
5. Talker receives the final deliverable only after Twin accepts it or surfaces unresolved disagreements explicitly. A failed Twin review call never counts as approval, new human input invalidates in-flight verdicts, and user stop prevents late reviews from restarting Worker.

The UI exposes Twin's replies, cited persona traits, requested revisions, and token spend. Anger states represent typed reactions to task quality rather than claims about the user's real-world mood, and Twin preserves the tone and directness evidenced in imported transcripts.

## Character Rendering, Training, and Controls

The Twin view mirrors the trailer layout: interactive 3D character, discovered transcript sources with live session counts, training flow, trait editor, and a sandboxed **Ask Twin** prompt. The character renders in real time via the v12 WebGL2 raymarched SDF shader (volumetric body, fur, eyes, paws, updated violet palette, and extended anger facial/body rig, with zero external mesh assets).

Starting training expands the portrait into the full stage over `500 ms`. Redacted message preview cards (up to 16 real excerpts per import, <= 4,000 characters each, kept strictly ephemeral in memory) arc continuously into Twin along overlapping trajectories: each absorption steers gaze and paws, impulses the spring rig, and ripples across the surface without resetting velocity, settling to `100%` and a ready reaction once the backend reaches `ready`. Pause and `prefers-reduced-motion` freeze both cards and character; cancelling returns immediately to source selection.

Users can drag to rotate Twin, move the cursor to steer gaze, click or press `Enter`/`Space` to greet, use arrow keys to rotate/look, and press `Home` to reset framing. The header toggle remains reachable mid-training: switching Twin off plays an `8s` farewell sequence (`6.5s` tearful reach, `~1s` gravity-accelerated topple as the supporting paw slips, normal-axis squash on impact, delayed crest/paw follow-through, and desaturation to gray over `2.4s`, persisted in `twin.json` so restarts render the resting gray pose directly), while toggling back on interrupts the fall and lifts Twin back up in color with hearts over `3.2s`. Disabling cancels active training while keeping already saved traits.

Rendering pauses off-screen and in hidden windows; thumbnails draw static poses, internal resolution scales with load up to `512 px` at max `1.5` DPR and `24 fps`, WebGL resources release on unmount, and a static WebP fallback covers pre-first-frame or lost-context states. Interacting with the 3D character makes zero model calls.

Supported transcript importers (`src/twin/`): **Claude Code**, **Codex**, **Cursor** (structured exports; raw native blob DBs are skipped), **OMP**, **Kilo**, **DeepSeek**, **OpenCode** (read-only SQLite), **Hermes** (read-only SQLite), and **Flecten**. Scanning inspects file metadata and SQLite schemas without uploading transcripts; training reads only user-selected sources, pairing verbatim user messages with preceding assistant context to extract irritation/approval/delight polarity, strength, voice phrasing, and `appliesWhen` backed by exact literal user quotes.

Newly learned traits activate Twin automatically on completion and support CAS editing/deletion (`expectedRevision`), plus zero-model manual lessons from IDE code diffs (`twin.teach`). Twin can also be enabled manually prior to training to enforce literal prompt intent without fabricated traits. All Twin model calls (`train`, `consult`, Worker reviews) accept a single JSON object (raw or inside one CommonMark code fence) validated by Zod and exact quote matching, recording spend even when malformed responses are rejected and publishing to memory only after atomic disk commit.

## Storage, Budgets, and Protocol

- **Persistence**: `.flecten/twin.json` (schema v2, atomic writes, fully separate from `.flecten/memory.json`).
- **Import caps**: up to 100 sessions, 160 messages, 64,000 characters (including assistant context), and 12 new traits per run; store holds up to 64 active traits and 5,000 processed message hashes (skipping unchanged messages on re-import).
- **Runtime context caps**: latest 16 human messages (<= 10,000 chars), latest 12 tool results (<= 12,000 chars), and most recently updated traits up to ~18,000 chars (no semantic embeddings or full-repo snapshots).
- **Visual inspection**: up to 2 recent Worker tool images (<= 2 MiB each) passed as native multimodal media from verified session attachments (never base64-in-text; skipped with an explicit prompt note on text-only models; Twin never launches browsers or takes screenshots itself).
- **Ask Twin (`twin.consult`)**: sends only the test question and first 32 active traits (excluding active chat history), requiring a valid trait citation and making zero model calls when the profile is empty.
- **Accounting & RPC**: Twin calls and Worker revision rounds roll up into the shared chat budget ledger (training tracked separately) via `twin.get`, `scan`, `train`, `cancel`, `configure`, `review`, `update`, `forget`, `teach`, `consult`, and durable `twin.activity` events.

"Training" updates a structured persona document rather than fine-tuning model weights; automated suites verify routing, cancellation, and bounded revision loops rather than guaranteeing subjective human agreement on open-ended tasks.
