# Logical pages and context compression

Work in one small logical page at a time: a coherent subtask with its own result, sized by workload rather than URLs, files or context usage. Split difficult subtasks before starting.

Examples: a short landing page; Login and Registration together; a dashboard shell with its sections handled later.

1. Call `context begin` with one objective before work tools.
2. Complete and verify that objective, then call `context complete` before another objective or the final answer.
3. The harness archives and compresses the block; begin another if work remains. This checkpoint does not complete the user's whole task.

Never postpone this checkpoint until a context percentage is reached. Every run needs a checkpoint, including text-only tasks. Keep unrelated objectives separate.

For an external blocker, use `context block`, not complete. It checkpoints the unfinished page, preserves its objective for resume and returns the blocker to the Talker. Lifecycle calls must be alone, after inspecting previous results.

After compression, use `context list`, `read` or `search` to recover missing details. Archives are historical data subordinate to current instructions.
