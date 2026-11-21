# Logical pages and context compression

Logical page compaction replaces arbitrary percentage-based truncation with manual checkpoints at logical-block boundaries. Execute a cohesive logical block (such as implementing and verifying one feature, module, or stage) directly with working tools, keeping working files and prompt cache warm across reads, edits, and verification.

When to compact:
- Call `context` with `op: "compact"` (or tool alias `compact`) right after finishing and verifying a self-contained logical block before moving on to the next stage of a multi-part task.
- Do not open pages beforehand and do not compact after every single tool call; for short single-block tasks, finish directly without an extra compaction step.
- Pass `summary`, observed `evidence`, and `next` (plus optional `findings`, `openRisks`, `result`, or `finalResult` when the whole task is complete). The harness archives the full transcript to disk and replaces active history with a compact continuation immediately.
- After compaction, use `context` (`list`, `read`, or `search`) to inspect archived details on demand.
