# Flecten: Desktop Design Standard

Flecten opens around a single task: write immediately, inspect the result, and drill down to changed files or command output when needed. On first launch, the composer is enough; agent activity, diffs, history, terminal, IDE, and Twin reveal themselves progressively as the work demands.

**Character: quiet surface, living seam.** Deep graphite frames the workspace while warm light text keeps reading effortless. Iris marks the user's active locus of control, and a brief, soft morph connects adjacent states of a single control. Even a static screenshot is unmistakable: quiet navigation in the frame, an open reading column, an iris-ruled prompt, a compact activity trace, and a clear outcome.

This document governs the desktop app. Token definitions live in [app.css](ui/src/app.css); the marketing site follows [web/design.md](web/design.md). Accessibility and truthful runtime state always outrank visual ornament. Target specifications here guide upcoming UI work; baseline gaps and rollout order live in [docs/DESIGN-RESEARCH.md](docs/DESIGN-RESEARCH.md).

## 1. At a Glance

At any moment, the screen must answer three questions in order: **Where am I? What is happening? What can I do right now?**

| State | Immediately Visible | Available on Demand |
| --- | --- | --- |
| New chat | "What should we do?" input and active workspace (if selected) | Model picker, access mode, attachments, `@` mentions, and settings |
| Agent running | Latest human-readable action, elapsed time, Stop button, and composer ready for follow-ups | Full tool sequence, command output, raw arguments, and reasoning |
| Run completed | Editorial response in the reading column plus compact pointers to real diffs or checks | Full file viewer, diff, command log, history, or structured report |
| Human decision needed | What is blocked, what target it affects, and explicit decision buttons | Exact permission scope, failure details, or affected files |
| Editor open | Active file tab and code buffer | Workspace search, Git status, agent diffs, and linked chat |

"Immediately visible" means recognizable without hover or memorized shortcuts. Never tuck primary actions into overflow menus just to make a frame look minimal; keyboard shortcuts accelerate controls that are already discoverable. Every claim in an activity row must sit one disclosure or one click away from its underlying evidence and return cleanly to the same scroll position. Never render a verification mark without real proof. When a run pauses on user input, place the question and its action buttons right above the composer.

On an empty thread, the composer explains the product by itself. At most one short contextual line may note the active workspace or why an action is unavailable. Avoid marketing headlines, prompt-starter tiles, or feature lists. Projectless chat works natively without fake placeholder folders.

## 2. Composition: Prompt to Outcome

Each region carries deliberate visual weight: the sidebar orients across projects and chats, the header confirms current location, and the central canvas belongs to content. Window controls, status pills, and counters never compete with primary content. Collapsing the sidebar keeps the task title and workspace view switcher legible.

**A thread consists of three distinct elements:**

1. **Prompt.** Shifted slightly right with a thin iris rule on its left edge, while keeping body copy left-aligned inside the block. Short prompts shrink-wrap; long prompts wrap naturally. Attachments and revision switchers stay attached to their prompt.
2. **Activity trace.** A low-profile expandable row aligned to the response axis: status mark, plain-language action, step count, and elapsed time when known. Expanded detail rows stack directly beneath it. Errors and blocks surface even when collapsed; reasoning remains optional. The chevron signals inspectable depth and the counter shows true volume - never pad space with invented percentages or repetitive pills.
3. **Response.** Editorial Markdown along a calm, continuous left axis. File chips, checks, and artifacts appear inline only when backed by real references. Images, live HTML summaries, diffs, and code blocks scale naturally to fit the content without wrapping everything in uniform card borders.

Task headers, activity traces, responses, and the composer share one left axis inside the workspace canvas. Give user prompts a slight right offset, allow wide tables and diffs extra room within their container, and right-align short numeric row metadata in `tabular-nums` (wrapping metadata below primary text on narrow widths). Vertical rules never span an entire conversation: they scope strictly to a prompt, panel seam, or active selection, preserving clear separation between user intent, agent execution, and output even without color.

**Signature gesture: dot expands into an edge.** The activity trace reserves a fixed left slot: a live indicator while running, replaced in place by an outcome icon on completion. Expanding extends a short vertical line beneath that slot, binding strictly the rows belonging to that run; collapsing leaves the icon and summary intact without shifting the response's reading position. When animated, only the vertical line grows; without motion, shared alignment and indentation carry the relationship. Keep this gesture exclusive to run traces - do not copy it into settings or generic lists.

### One Context, Multiple Views

- **Agent and IDE.** The header switch toggles between Agent and IDE views of the same task while preserving the active chat, unsent draft, and attachments. IDE shows one active left panel (`Files`, `Search`, `Source Control`, or `Agent Changes`), tabbed CodeMirror editors in the center, and a toggleable chat dock on the right sharing the same composer. Buffers, cursor positions, undo history, and unsaved edits persist; external write conflicts prompt explicitly. Agent file mutations open directly in the editor diff view.
- **Conversation, Changes, History, and Terminal.** Distinct views of the active task. By default, the chosen view fills the workspace. Split mode is explicit, persists as a preference, and renders side-by-side only when width allows. Subagent tabs and module surfaces appear in navigation only when active. Never open empty split panes for symmetry.
- **Viewport thresholds.** Agent split requires at least `1000 CSS px` of workspace width after subtracting the sidebar. With the sidebar open, split fits at `1480x940` and collapses to a single full-width view at `1180x640`. Width checks account for collapsed sidebars and interface zoom. Editors, diffs, and terminals scroll long lines horizontally inside their own containers without widening the window layout.
- **Scroll ownership.** Every pane has a single vertical scroll owner. Brief disclosures expand in flow; bounded command logs and code editors scroll inside clearly bounded regions. Returning to a chat restores both scroll position and expanded rows. Streaming auto-follow at the bottom of a thread is distinct from reading history upward - incoming chunks never yank scroll back down.
- **Structural seams.** One hairline seam divides sidebar from workspace; a second appears only when split view is open. Input borders, table dividers, and focus rings solve distinct problems - use them only where boundaries or interactivity would otherwise be unclear, rather than boxing every group.

## 3. Visual Language

Any Flecten screenshot reads immediately through three cues: a slightly lighter workspace field set inside deep graphite chrome, editorial thread typography, and sparse iris accents marking active focus. Hierarchy comes from proportion, density contrast, and content itself so a one-line question, a dense engineering report, and the Twin stage feel like distinct scenes on the same canvas.

| Role | Tokens | Usage |
| --- | --- | --- |
| Window frame | `--sidebar`, `--panel` | Sidebar navigation and utility rails (quietest plane) |
| Workspace canvas | `--bg`, `--surface` | Thread, editor, and prose background; `--surface` groups composer and paired controls |
| Elevated layer | `--raised`, `--raised-hover` | Open menus, active dialogs, local floating controls; cast shadows only when overlapping lower layers |
| Text | `--text`, `--text-body`, `--text-2`, `--muted` | Headings, body prose, navigation, and metadata (reinforce hierarchy with size, placement, and weight) |
| Iris | `--primary`, `--primary-end`, `--primary-hover`, `--on-primary` | Brand mark, primary CTA, focus ring, active selection, live indicator, and prompt rule |
| Semantic | `--success`, `--warning`, `--error`, `--add`, `--del` | Verified outcomes and real diffs only, always paired with text or distinct iconography |

Desktop palette: graphite neutrals, warm light text, and iris `#b7a1e8` (exact values live in `ui/src/app.css`). Limit each view to at most one prominent accent fill while allowing small selection markers, focus rings, and semantic indicators to coexist. The primary button's subtle gradient models top-down light on material while broad surfaces stay flat. Provider brand colors and subagent avatars stay confined to their own badges.

Light falls from above: a crisp top highlight defines raised edges, while deep drop shadows appear exclusively on genuinely overlapping popovers and modals. Modal backdrops may dim and softly blur underlying layers while keeping foreground content sharp. Permanent glassmorphism, ambient background gradients, cursor spotlights, confetti, tilted cards, and decorative grain are excluded from the desktop app.

Nested border radii scale concentrically with padding. Primary controls use rounded rectangles; pills denote compact filter chips, badges, or segmented toggles. Align small icons by optical center and visual mass rather than raw bounding boxes, and proportion radii to container scale rather than applying one radius everywhere.

### Typography and Spacing

| Role | Target Spec | Usage |
| --- | --- | --- |
| Task title | `24-30 px`, `500`, `1.15-1.25` | Single focal heading per view; use larger end only when surrounding space is open |
| Section heading | `16-18 px`, `600`, `1.25-1.35` | Landmarks inside long reports or settings panes |
| Reading prose | `16 px`, `400`, `1.5-1.65` | ~`60-65ch` measure for long-form answers; narrows naturally on smaller viewports |
| Controls | `13-15 px`, `400-600` | Buttons, list rows, navigation; lead labels with the action verb |
| Metadata | `12-13 px`, `400-500` | Timestamps, counters, captions (`11 px` strictly for terse secondary tags) |
| Technical data | System monospace stack | Code blocks, file paths, and aligned numeric/tabular columns |

`Manrope` is the sole brand typeface, backed by locale-appropriate system fallbacks and the system monospace stack for code. Prose uses looser line-height than UI chrome, and numeric readouts enable `tabular-nums`. Hold a clean left edge on body text, balance short headings, and keep truncated paths keyboard-accessible with the filename preserved. Never add positive letter-spacing to lowercase Russian or Ukrainian text, and test layout resilience across all seven supported locales.

Use three spacing tiers from `app.css`: `4-8 px` for tightly bound pairs, `12-16 px` within a semantic group, and `24-32 px` between distinct dialogue episodes (`2 px` reserved for optical alignment). Prioritize generous episode separation in threads and compact density in utility lists over uniform padding everywhere. Maintain a consistent `12 px` composer inset in both empty-screen and bottom-docked states.

## 4. Control Behavior

| Surface | Rule |
| --- | --- |
| Composer | Input field and action bar align cleanly; focus rings never shift size or border radius. Attachments and voice input stay secondary; model and access mode carry text labels. `Send`, `Stop`, and `Continue` anchor to the same right slot. When a run is active and the draft is non-empty, `Queue` and `Steer` appear immediately left of `Stop`. In Talker chats, `Send` replaces `Steer` so button clicks and keyboard shortcuts message Talker directly while Worker continues running. |
| Execution | First `Stop` click requests graceful stop (finishing in-flight stream/command); once graceful stop is acknowledged, the next click triggers immediate `Force stop`. Label both states literally and show `Stop` or `Continue` strictly when valid. |
| Drafts | Scoped per task. Async file-picker completions attach to the task that opened the dialog even if the user switches chats. Editing a prior message isolates its own draft from any unsent bottom-composer draft and clearly indicates that saving creates a new conversation branch. |
| Voice and queue | Recording swaps the mic icon for stop-recording in the exact same slot, exposing dictation status and target via tooltip and ARIA labels. Queued follow-up messages render in a dedicated list above the composer. |
| Permissions and errors | Approval prompts dock directly above the composer with exact resource scope and explicit action buttons. Errors state what failed, what stayed intact (when known), and the next recovery step; transient toasts are never the sole record of a run failure. |
| Menus, inputs, tooltips | Shared floating layer clamped to trigger and viewport bounds. Custom `select` and `combobox` controls support full keyboard navigation and explicit disabled states; checkboxes, sliders, and progress bars preserve native platform semantics. `data-tooltip` opens after `500 ms` on hover, immediately on keyboard focus, and closes on `Escape`. |
| Settings | Lead with plain-language form controls; keep raw JSON behind an explicit advanced toggle and collapse paths/diagnostics until needed. Opening Settings preserves underlying workspace state and restores focus on close. |
| Transient feedback | Copy actions confirm inline within the same button width. Toasts never obscure the composer or steal focus; error toasts auto-dismiss after `6 s` (pausing on hover/focus) while run errors remain in thread history. |

Lead activity rows with the action and target when known - for example, "Checking UI" with `bun run build:ui` in expanded details, transitioning to "Build passed" with exit code and output underneath. When only a raw command is known, display the command verbatim rather than guessing intent. Keep internal status codes, JSON payloads, full logs, and raw arguments inside disclosures. Surface spend inside context details and warn proactively near budget limits. Counter increments, stop-state transitions, and stream completion must never reflow the page or collapse user-expanded rows.

## 5. Motion: Sparse, Purposeful Transitions

Every animation must satisfy: **when X happens, motion helps the eye track Y**. Press feedback starts immediately, every transition is interruptible in flight, and underlying state plus focus update without waiting for animations to finish. Avoid word-by-word text cascades, rolling odometer digits, springy list physics, post-stream response re-animations, or error shake effects.

| Event | Reference Timing and Rule |
| --- | --- |
| Press / hover | Native CSS `:active` with `scale: 0.96` on standard buttons when motion is enabled; `150 ms` color transition; zero global pointer listeners. |
| Settings section switch | `140 ms` in-place opacity swap; typing or focus changes never re-trigger section transitions. |
| Activity detail disclosure | `220 ms` open, `160 ms` close on a monotonic curve, cleanly interruptible on rapid toggles. |
| Workspace view & dock | Incoming edge enters along the spatial direction of the pane (`190 ms` view, `240 ms` dock): thread from left, dock from right; sidebar border and grid track move in lockstep. |
| Popover / modal | Short directional entrance from trigger (`FloatingMenu` `180/120 ms`, modal backdrop `220/160 ms`) without blurring foreground text. |
| Segmented mode, tab, or task pill | Single shared selection indicator per control; when sliding between adjacent items, a subtle trailing bridge connects old and new slots while text labels stay stationary, without stacking trails. |
| Send, Stop, Continue, voice, copy | Local glyph morph inside a fixed-size slot synchronized with accessible label and action updates; subtle shape elasticity must never delay execution or distract reading. |
| Live indicator & Twin | Live indicator renders strictly during genuine active execution; Twin shifts pose contextually inside its dedicated stage while keeping every status legible in a still frame. |

Goo metaball effects live strictly on an `aria-hidden` layer with `pointer-events: none`, decoupled from labels and hit targets, using one SVG filter per control (`#goo` and `#goo-tight` in [GooFilters.svelte](ui/src/components/GooFilters.svelte)). Feed opaque shapes into the filter and apply alpha outside it; resting trail and base shapes must align identically. Recompute geometry only on selection or resize events - never read layout on `requestAnimationFrame` ticks - and ensure active labels plus static indicators remain legible if the filter is disabled.

Reserve WebGL strictly where a 3D/shader object carries semantic state. Twin expresses persona state within its own stage and ships a pre-rendered static fallback; it never bleeds into the thread. Within the thread, `LiveGlow` stays strictly subordinate to the readable status mark. Cap active WebGL contexts at one visible scene per workspace view, halt `requestAnimationFrame` when hidden, handle WebGL context loss gracefully, and add no new ambient shaders or glows. Rely on standard CSS, SVG, and the Web Animations API elsewhere.

`prefers-reduced-motion` disables spatial translation, morphing, pulsing, animated blur, stagger delays, and animated render loops, presenting final static states immediately while keeping text, code, numbers, and hit targets rock-steady. Always list explicit animated properties in `transition` declarations - never `transition: all`.

## 6. Legibility and Trust

- Contrast meets WCAG 2.2 AA: at least `4.5:1` for body copy and `3:1` for large headings plus essential control borders, icons, and focus rings measured against actual composited surfaces (including alpha layers). Muted labels remain readable, and sticky bars or docks never occlude focused elements.
- Hit targets measure `32 px` for standard compact desktop controls, `28 px` for dense secondary controls, and `44 px` on coarse pointers. Never shrink clickable bounds to match small icon glyphs, prevent overlapping hit boxes, support standard keyboard traversal, and return focus to the invoking trigger (or nearest logical control) when dismissing overlays.
- Pair every color cue with text, shape, or distinct iconography. Announce meaningful state changes and errors to screen readers without spamming every streamed token or timer tick, using standard ARIA roles and states for tabs, disclosures, and dialogs.
- English (`en`) is the default UI language alongside Simplified Chinese, Brazilian Portuguese, Spanish, Japanese, Ukrainian, and Russian. Translate whole sentences via locale catalogs while preserving user messages, file paths, code, and diagnostic logs verbatim. Never use em dashes (`U+2014`) in UI copy or documentation.
- Keep copy direct and literal: "Allow reading folder" over "Elevate access permissions"; "Could not open file. Reselect the project folder" over "Something went wrong." Deliver identical facts across mouse, keyboard, and screen readers. Label prototypes explicitly and never disguise canned test output as live model work.

## 7. Design Acceptance

1. **First-time clarity.** Put a new chat or workspace view in front of someone unfamiliar with the screen: can they start a task, read current status, and pick the next action unprompted while an empty thread still provides sufficient orientation?
2. **Distinct hierarchy at target viewports.** Compare before/after captures at `1480x940` and `1180x640` across empty chat, user prompt, active run, finished answer, expanded trace, and error states. Verify clear structural tiers (never a stack of uniform cards), long filenames, OS display scaling, and longest-locale translations, ensuring narrow windows prioritize the active pane while keeping actions reachable under zoom.
3. **Verifiable round-trips.** Follow an answer reference into a real file or check, return to the exact reading offset, switch tasks with an unsent draft, verify user-opened disclosures stay open after run completion, and confirm split view collapses and restores cleanly across resize thresholds.
4. **Keyboard, contrast, and motion.** Walk the full flow by keyboard, audit composited contrast across interactive states, verify `prefers-reduced-motion`, and test mid-transition interruptions rather than judging interactive UI from a single static frame.
5. **Architectural discipline.** Consume tokens from `app.css`, state from `run.svelte.ts` and props, and runtime truth from schema-validated events. Components never read files or invoke core directly; add no dependencies or product actions purely for visual demo value, and run all required checks in [AGENTS.md](AGENTS.md) when code changes (edits confined to this spec alone do not count as shipped UI).

Selected interaction patterns and rejected alternatives are documented in [docs/DESIGN-RESEARCH.md](docs/DESIGN-RESEARCH.md).
