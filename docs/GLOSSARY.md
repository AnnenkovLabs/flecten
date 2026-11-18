# Glossary

**Twin**: Session client persona representing the user. Drafts specs, answers trade-off questions at decision points, and issues acceptance verdicts.

**Critic**: Twin running in a clean context window. Sees only the raw user prompt, the spec, and the resulting diff, without intermediate Worker history.

**Worker**: Execution agent. Operates one page at a time, seeing only the spec, assignment brief, prior page handoffs, and the active page.

**Scout**: Read-only reconnaissance agent. Gathers relevant files, symbols, codebase patterns, and risks before Worker requests context.

**Orchestrator**: Lightweight model paired with deterministic rules. Picks the next step and page boundary, and replans after failures.

**Janitor**: Post-session maintenance pass. Proposes profile entries and updates the curated term base.

**Spec**: Session contract defining objective, non-goals, acceptance criteria, user voice, verification gates, and allowed sources.

**Criterion**: Testable requirement in a spec. One page maps to one criterion.

**Page**: Atomic unit of execution, closed once its criterion is backed by verified evidence.

**Handoff**: Structured summary produced when closing a page: what changed, where, active invariants, next step, and risks.

**Gate**: Verification command declared in the spec. Gate failures return to Worker as tool results.

**Profile**: Five user-memory collections: `preferences`, `vocabulary`, `taste`, `anti_patterns`, and `decisions`.

**Taste-diff**: Manual edits the user makes directly after an agent run; primary signal for `taste`.

**Term base**: Curated glossary file (`terms.jsonl`) recording definitions with provenance and dates.

**Session**: Single end-to-end task lifecycle from raw user prompt to final verdict.

**Frame**: Unused term; avoided as overly generic.
