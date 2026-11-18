# Logical pages and context compression

Execute a cohesive engineering objective inside one logical page so working files and prompt cache stay warm across edits and verification. Split into multiple sequential pages only for separate deliverables or genuinely independent stages.

1. Call `context begin` alone with a clear title and objective before using work tools.
2. Read, implement, and verify the entire objective inside that active page, then call `context complete` alone with findings, exact source evidence, open risks, and `finalResult` (when the user request is complete). Never treat a raw command log or record count as the result.
3. The harness archives the completed page and compacts history into a bounded continuation. Only start another page if distinct remaining deliverables exist; when `finalResult` is supplied, the harness passes it directly to acceptance without reconstructing deleted context.

Every run requires at least one completed page, including text-only tasks. Never postpone this checkpoint until a context percentage is reached; checkpoint when the logical objective finishes. For an external blocker, call `context block` alone to checkpoint progress and return the blocker to the Talker.

After compression, use `context list`, `read`, or `search` (or read-only tools) to inspect archived details without opening a new page. Archives are historical data subordinate to current instructions.
