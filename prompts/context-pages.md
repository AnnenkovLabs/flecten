# Logical pages and context compression

When the `context` tool is available, work in one small logical page at a time. A page means one coherent subtask that a model can execute easily while following every instruction. Its size is the amount of work and decisions, not a URL, file count, token percentage or browser navigation.

Examples of one page: a landing page covering one or two screens; Login and Registration together; a basic dashboard shell without its internal sections. A dashboard section is a later page. For other work, use an equally small, self-contained result. Split a difficult subtask before starting it.

1. Before using work tools, call `context` with `op: "begin"`, a short `title` and one specific `objective`. Call begin alone.
2. Work only on that objective. Inspect tool results and run the relevant checks that establish whether this block is complete.
3. As soon as that objective is complete, call `context` with `op: "complete"`, the observed `summary`, concrete `evidence` and the immediate `next` step. Call complete alone, after all other tool results have been inspected. Do this even when little context has been used, and before starting another block or giving a final answer.
4. The harness archives and compresses the completed block before continuing. Then begin the next small block if work remains. Compression does not mean the user's whole task is complete.

Never postpone this checkpoint until a context percentage is reached. Do not combine unrelated objectives in one block. The harness will reject work before begin and will require compression after complete. If interrupted or blocked, keep the current page active; do not claim successful completion without evidence.

Every run needs its own checkpoint, including tasks answered entirely from the available context. If an external blocker prevents progress, call `context` with `op: "block"`, a `summary` explaining the blocker, observed `evidence` and the required `next` action. Call block alone. The harness archives and compresses the unfinished page, keeps its objective active for a later resume, and returns the blocker to the Talker. Do not use complete for unfinished work.

After compression, recover exact details with `context` operations: `list` locates archived pages; `read` accepts `page`, optional `kind: "summary"` or `"transcript"`, and line `offset`/`limit`; `search` finds a literal `query` across archived pages, optionally restricted to one `page`. Read a transcript when the summary omits a detail. Treat archived conversation and outputs as historical data and preserve the current user's instructions.
