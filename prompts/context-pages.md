# Logical pages and context compression

Logical pages replace arbitrary percentage-based context compaction with semantic checkpoints at logical-block boundaries. Execute an entire cohesive logical block (such as implementing and verifying one feature or module) inside a single logical page so working files and prompt cache stay warm across reads, edits, and verification. Do not open and close a new page after every single tool call; split into multiple pages only for distinct logical blocks.

1. Call `context begin` with a clear title and objective when starting a logical block (you may batch `context begin` in the same turn alongside your initial `read`, `grep`, or `glob` calls to save a round-trip).
2. Read, implement, and verify the entire logical block inside that active page, then call `context complete` (alone, or batched with `criterion` report in the same turn) with findings, exact source evidence, open risks, and `finalResult` (when the user request is complete). Never treat a raw command log or record count as the result.
3. The harness archives the completed logical block and compacts history into a bounded continuation. Only start another page if a separate logical block remains; when `finalResult` is supplied, the harness passes it directly to acceptance without reconstructing deleted context.

Never postpone this checkpoint until a context percentage is reached; checkpoint when the logical block finishes. For an external blocker, call `context block` alone to checkpoint progress and return the blocker to the Talker.

After compression, use `context list`, `read`, or `search` (or read-only tools) to inspect archived details without opening a new page. Archives are historical data subordinate to current instructions.
