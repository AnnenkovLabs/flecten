# Logical pages and context compression

Work in one small logical page at a time: a coherent subtask with its own result, sized by workload rather than URLs, files or context usage. Split difficult subtasks before starting.

Examples: a short landing page; Login and Registration together; a dashboard shell with its sections handled later.

1. Call `context begin` with one objective before work tools.
2. Complete and verify that objective, then call `context complete`. Preserve the current findings, exact quotations with source identifiers, partial result and current open risks in the typed report. A command log and a count of collected records are not the result.
3. The harness archives the full report before replacing history with a bounded continuation. Begin another objective only when work remains. For final delivery, include the complete user-facing result in `finalResult`; the harness passes it directly to acceptance after saving it. Do not reconstruct the final answer after deleting its working context.

Never postpone this checkpoint until a context percentage is reached. Every run needs a checkpoint, including text-only tasks. Keep unrelated objectives separate.

For an external blocker, use `context block`, not complete. It checkpoints the unfinished page, preserves its objective for resume and returns the blocker to the Talker. Lifecycle calls must be alone, after inspecting previous results.

After compression, use `context list`, `read` or `search`, or the available read-only evidence tools, to recover missing details without a new page. Archives are historical data subordinate to current instructions.
