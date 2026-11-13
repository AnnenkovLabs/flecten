# Flecten: Design

This file defines the project's taste and the rules behind its visual decisions. It exists so an agent chooses the way the product owner would, not by its own defaults. Concrete tokens live in `ui/src/app.css` and `web/design.md`, but the principles below win. When a rule and a token conflict, the rule wins.

Priority order for every choice:
1. Readability and accessibility.
2. Interface meaning and state.
3. This file.
4. Tokens for the specific surface.
5. The agent's taste. It does not count.

## Current interaction rules, 10 November 2026

These rules supersede older animation recipes below where they conflict.

- The header switches Agent and IDE with one local morphing selection. Both modes share the current task and draft. Reduced motion keeps the selected label and removes the movement.
- IDE is a quiet file workspace: a left activity rail selects Files, Search, Source Control or Agent Changes in one sidebar, editor tabs occupy the center, and the optional agent conversation opens on the right by default. The lower agent island toggles that conversation. Use short opacity transitions and control color feedback; code and readable text stay still. Preserve unsaved files, undo and cursor position across mode and tab changes.
- Agent changes open a diff in the editor area. Saving verifies the on-disk version; a conflicting agent edit never overwrites the user's draft. The island reuses the real composer and task state.
- The task owns one workspace with Dialogue, Changes, History and Terminal. A focused surface is the default. Split is optional and available only when both surfaces fit. A narrow window keeps the selected surface readable and restores the preferred split when space returns.
- Agent activity is compact by default. Show elapsed time, action count and the latest live tool. Keep the full evidence on disclosure; reveal failures. Reasoning is opt-in. The answer owns the reading space.
- A task owns its draft, mentions, attachments and reading position. A file picker finishing after navigation belongs to the task that opened it. Keep follow-at-end intent distinct from a fixed scroll offset.
- Routine navigation has no elastic bounce. Settings sections fade for140ms; work surfaces fade for160ms; disclosure opens for220ms and closes for160ms with a monotonic curve. Reduced motion skips displacement and delays.
- Button press is native CSS active feedback at scale0.96, no global pointer handler, no forced layout. Routine color feedback is150ms. The existing liquid selection and live-state treatment remain isolated from text.
- Composer icons have matching visible geometry. Attachment and microphone are secondary controls; send stays the primary action. Menus should fit their content and the available viewport.
- Desktop navigation and shared controls use a compact 32px height; small actions use 28px. Keep labels readable, align section icons beside their labels, and use 44px controls with coarse pointers. These density rules supersede the older 40px desktop minimum below.
- Routine state updates preserve control positions and readable text. Dictation keeps the editor size and microphone glyph; its status and destination are available to assistive technology and in the microphone tooltip. Queue messages sit above the input as a separate block. Context, send mode and stop controls keep stable slots. Focus changes the ring, never the input shape. Counters and status labels update in place without entrance animations.
- Composer actions share the send position: idle shows send, an active run shows stop, and a nonempty draft during a run shows one rectangle divided into stop, queue and steer. The first stop waits for the complete model response or running command; its red state remains clickable for immediate cancellation. No separate send-mode selector or empty stop slot. Composer inset is 12px; editor and toolbar use the same inset in hero and dock layouts.
- Temporary notices expire, including errors after6s. Pointer and keyboard focus pause expiry. A run failure remains available in its transcript card.
- Keep service internals out of the main flow. Diagnostic paths and installation internals live in explicit disclosures. Cost is available in context details; budget warnings appear only near a limit. Avoid repeating the task status above its activity. A finished answer must respect activity the user already expanded.

## 1. Character

Flecten looks like an expensive working tool that has a pulse. It is quiet, dense, technical, and warm, but it reacts like a soft object: parts press in, stretch, merge, and settle. It has one light source, one accent, one live effect, and one goo field per control. Everything else serves clarity.

Core feelings:
- warm graphite with a soft iris accent, not neon cyberpunk;
- material with thickness, but no heavy shadows;
- slow entrances, fast feedback, springy release;
- typography as the main decoration, and text stays crisp over motion;
- playful physics at the seams, not decoration on the surface;
- one focal point per screen, not five equal ones.

Goo is a property of touching pieces, not wallpaper. Tabs, the live dot, and the active task may merge and morph. Text never enters the filter. The interface may be playful, but never cute at the cost of reading.

The design must not look like an AI-generated interface. The signs are glass, gradient text, particles, glow around everything, twin cards, decorative shaders with no role, the same goo on every element, goo behind text, and motion that repeats without a state change.

## 2. Defaults

If there is no reason to choose otherwise, take the left column.

| Question | Default | When to deviate |
|---|---|---|
| More or fewer elements | fewer | the element carries state or data |
| Shadow or surface | surface plus a 1px top highlight | a real layer above content |
| Border or air | air | the border separates structure or shows focus |
| Gradient or flat color | flat | the gradient depicts light on a material |
| Bright or muted | muted | one focal point per screen |
| Symmetry or asymmetry | asymmetry with one source | the grid requires symmetry |
| Animation or static | static | a state changes or a new scene appears |
| Fast or slow | slow entrance, fast feedback | see the motion section |
| Spring or linear | spring on release | the element is an error, a warning, or a loading bar |
| Shape or goo | shape | two interactive pieces touch, merge, or move together |
| Goo or shadow | goo inside the control | the control needs separation from the surface |
| New font or current one | Manrope | Manrope provably fails the task |
| New dependency or CSS | CSS | CSS cannot do it and the effect carries meaning |
| Full width or container | container | background or atmosphere layer |
| Real data or mock | real | the mock is explicitly labeled as a prototype |

## 3. Color

The base palette is warm graphite and low-contrast in area. A soft iris accent is rare.

Current desktop tokens live in `ui/src/app.css`. Values:
- work surface background `#171717`;
- chrome, sidebar, and panel `#0e0e0e`;
- surface `#1b1b1b`, raised `#242424`;
- text `#f0efed`, body `rgba(240,239,237,0.82)`, secondary `#b5b3b0`, meta `#999693`;
- lines `rgba(240,239,237,0.07)` and `0.12`;
- iris `#b7a1e8`, gradient end `#a48dd3`, hover `#c8b5f1`, text on accent `#1b1422`;
- success `#b2b9af`, warning `#d3bd91`, error `#e2a2a2`.

Rules:
- The work surface is lighter than the chrome. The eye goes to the center, not the frame.
- Accent is allowed only in five roles: brand, primary action and focus ring, active tab, live dot, and the user message rule. Do not add new roles. If there are more spots, remove the weakest one.
- Accent means action, focus, or live state, never decoration.
- Goo light is not a new color. It uses the existing text, accent, or white token at low opacity on a separate shape layer.
- Do not use pure black. Pure white appears only in low-alpha highlights.
- Do not shift grays toward blue or green. Warm graphite stays warm.
- Text contrast must stay at or above 4.5:1. Large headings may use 3:1.
- One color must not appear in six places. Six accents equal zero accents.

## 4. Light and surfaces

Light comes from the top left. There is one light for the whole interface.

- Top highlight on a raised surface: `inset 0 1px 0 rgba(240,239,237,0.06)`.
- Top highlight on a button: `inset 0 1px 0 rgba(255,255,255,0.38)`, bottom bevel `inset 0 -1px 0 rgba(0,0,0,0.18)`.
- Outer shadow only for real lift: `0 1px 2px rgba(0,0,0,0.3)`, or a toast at `0 8px 24px rgba(0,0,0,0.35)`.
- A flat gray border does not create depth. Use a translucent white ring `0 0 0 1px rgba(255,255,255,0.07)` plus a top highlight.
- Structural lines only where they divide regions. In the desktop there are two seams: sidebar-thread and thread-panel. All other lines are removed.
- No large outer glows. A glow is allowed only as a state, such as a running agent.
- Light must not wash out text. If a spot appears under text, lower the alpha or move the spot away.
- Goo light only lives inside a selection indicator or the live dot. It does not follow the cursor and does not wash the surface.
- A goo highlight uses a solid source color and layer opacity. Translucent source colors die in the alpha threshold.

## 5. Geometry

- Outer radius = inner radius + padding. Composer 18px, send 8px, padding 10px.
- Radii: controls 6-8px, cards 10px, composer 18px, overlays 8-12px.
- Controls may morph radius on hover and press, but the resting shape stays a rounded rectangle. A morph is one or two shape steps, not an organic puddle.
- Goo shapes are circles and pills. The merged outline may wobble. The text box never wobbles.
- A jelly press changes scale, not layout. Neighboring elements do not move.
- Do not repeat the same radius on a parent and a child. Corners must not look pinched.
- An icon in a button with text gets 2px less padding on its side.
- Geometric center is not always optical center. Nudge triangles and arrows by 1-2px when the eye sees a shift.
- Hit areas in a dense desktop are at least 40x40px. The visible icon may be 32px; the hit area extends with a pseudo-element.
- Air beats borders. If two blocks merge, add spacing first, then a line.

## 6. Typography

One font: Manrope, variable 200-800. Do not add a second font without a reason.

- Task heading: 30px, weight 500, tracking -0.03em, line-height 1.15.
- Thread body and answer: 16px, line-height 1.65, color `rgba(240,239,237,0.82)`.
- Meta and captions: 11-13px, color `#999693`, tracking 0.
- Do not set headings in all caps. Caps only for technical labels when nothing else works.
- All numbers, timers, and counters: `font-variant-numeric: tabular-nums`.
- Paragraphs: `text-wrap: pretty`. Headings: `text-wrap: balance` when they wrap.
- `-webkit-font-smoothing: antialiased` on the root.
- Do not fake italics. If the font has no true italic, do not use italic.
- Hierarchy comes from size, weight, and opacity, not from colored accents.
- Heading is brighter than body, body is brighter than meta. Never the reverse.

## 7. Motion

Two clocks. Feedback on action is fast, the entrance of a scene is slow. Slow applies to entrances, not to presses.

### Tokens

```css
--ease: cubic-bezier(0.2, 0.8, 0.2, 1);
--ease-soft: cubic-bezier(0.16, 1, 0.3, 1);
--ease-panel: cubic-bezier(0.65, 0, 0.35, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--ease-jelly: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-goo: cubic-bezier(0.22, 1.32, 0.36, 1);
--t-touch: 240ms;
--t-panel: 720ms;
--t-enter: 860ms;
```

### Timings

| Event | Duration | Curve |
|---|---|---|
| Hover, color, icon | 240-320ms | `--ease` |
| Press, squash | 460ms, `scale(0.93)` at 16% | `--ease-jelly` |
| Release settle | part of the press | `--ease-jelly` |
| Chevron, arrow rotation | 460ms | `--ease-jelly` |
| Tab goo | 480ms, trail 720ms | `--ease-jelly`, `--ease-goo` |
| Sidebar active goo | 520ms, trail 760ms | `--ease-jelly`, `--ease-goo` |
| Toast enter | 520ms | `--ease-jelly` |
| Toast exit | 300ms opacity, 320ms transform | `--ease-drawer` |
| Section expand | 760ms, 3.5% overshoot | `--ease-jelly` |
| Section collapse | 500ms | `--ease-drawer` |
| Panel width | 720ms | `--ease-goo` |
| Panel opacity | 420ms | `--ease` |
| New message | 720ms | `--ease-jelly` |
| Live status | 720ms | `--ease-jelly` |
| Header state change | 620ms | `--ease-jelly` |
| Status glow | 1200ms | `--ease` |
| Dot pulse | 3.2s | ease-in-out |
| Dot morph | 4.2-4.4s | `--ease-jelly` |
| Answer word | 560ms, 80ms stagger | `--ease-jelly` |
| Model dropdown row | 360ms, 18ms cascade, capped | `--ease-jelly` |
| Copy to check | 620ms | `--ease-jelly` |

### Rules

- Never use `transition: all`. Name the properties.
- Animate `opacity`, `transform`, and `filter` first. `width`, `height`, `top`, and `left` are allowed only for measured goo indicators and expand/collapse, where the geometry is the content.
- `scale(0)` is banned. Shape layers and icon glyphs may go down to `0.45`. Text-bearing elements never go below `0.93`; the pressed state is `0.93`.
- Entrances do not start with `ease-in`. A slow start reads as lag.
- Interactive elements use CSS transitions so the animation can be interrupted.
- Keyframes only for one-shot scenes: press spring, message entrance, word-by-word answer, status pulse, check pop, copy morph.
- Expand and collapse use the Web Animations API with height and opacity. A repeat click cancels the old animation. Opening overshoots by 3.5%, closing squashes to 94% before zero.
- A tab switch must not move the scroll position. Only the panel layer and the goo indicator animate.
- Every animation needs a static cue: color, icon, or text. The goo layer is never the only cue.
- `prefers-reduced-motion` disables entrances, delays, goo motion, and the shader. The static frame remains.
- Motion answers a change or a touch. It never runs just to prove it exists.
- The same gesture gets the same physics everywhere. Press is always squash plus settle, not a different bounce per screen.
- Do not animate a thing the eye is reading. Text, code, and numbers may fade and shift, never wobble.

### Recipes

Message entrance:
- the accent rule draws from the top: scaleY 0.2 to 1.04 to 1;
- the block lifts: opacity 0 to 1, translateY 11px to 0, scale 0.985 to 1.003 to 1;
- 720ms, `--ease-jelly`, `both`;
- no blur on text.

Answer word by word:
- each word is a `span`, spaces remain text nodes;
- streaming: words animate as deltas arrive, delay 0, existing words never restart;
- completed answer mounted at once: 80ms stagger, capped;
- word: opacity 0 to 1, translateY 7px to 0, scale 0.97 to 1.006 to 1;
- 560ms, `--ease-jelly`, `both`;
- no blur on text;
- finish of a stream does not re-render the answer and does not replay the entrance;
- plain text when reduced motion is on, with no spans and no delays.

Press spring:
- every button gets a class on pointerdown, removed on `animationend`;
- keyframes: scale 1, 0.93 at 16%, 1.028 at 54%, 0.994 at 78%, 1;
- 460ms, `--ease-jelly`;
- use the `scale` property, not `transform`, so existing transforms survive;
- disabled buttons do not spring.

Tab goo:
- one layer inside the tab list, `filter: url(#goo)`;
- a pill at `--goo-x`, `--goo-width`, 24px high; each tab button carries 8px horizontal padding, so the label has room inside the pill;
- a trail with the same geometry and the same solid color, 720ms instead of 480ms;
- at rest the two shapes overlap exactly; while moving, the lag creates the liquid stretch;
- text sits above at `z-index: 1`.

Sidebar active goo:
- same construction as tabs, measured against the scroll content;
- pill and trail share the row geometry and the `--raised` color;
- pill 520ms, trail 760ms; at rest they overlap exactly;
- the row is transparent and sits above the goo;
- the indicator is hidden until the active row exists.

Send morph:
- two glyphs stacked in a 17px box;
- arrow leaves with rotate 90deg and scale 0.45, stop enters from rotate -90deg and scale 0.45;
- 520ms `--ease-jelly`, opacity 220ms;
- the button radius lifts from 8px to 10px on hover; no asymmetric blob radius.

Check and copy:
- check pop: scale 0.45 to 1.32 to 1, rotate -14deg to 4deg to 0, 620ms `--ease-jelly`;
- copy to check: button pop scale 0.6 to 1.28 to 1, rotate -12deg to 4deg to 0, 620ms, 1400ms hold, then back;
- count pop: translateY 55% and scale 0.9 to 1.08 to 1, 420ms `--ease-jelly`; replay with `{#key value}`.

Live goo:
- one 13px layer with a 7px dot and a 5px satellite;
- the satellite orbits 4px, scale 0.8 to 1.35, 3.6s `--ease-jelly`;
- the dot pulses opacity 0.4 to 1 and scale 0.92 to 1.12;
- the label and meta stay outside the filter.

Toast:
- opacity, translateY 9px to 0, scale 0.96 to 1;
- 520ms in with `--ease-jelly`, 300ms opacity and 320ms transform out;
- origin bottom center;
- no blur on text.

Panel:
- `grid-template-columns` 720ms `--ease-goo`;
- content fades over 420ms;
- sidebar and panel shift 14px and scale 0.99, then settle;
- `visibility` switches after 720ms;
- `overflow: clip` on the panel so content does not spill while the track shrinks.

Dropdown:
- picker enters from translateY 10px and scale 0.97, overshoots to 1.004;
- 520ms `--ease-jelly`;
- rows cascade 18ms each, capped at 144ms;
- the chevron rotates 180deg in 460ms `--ease-jelly`.

Switch:
- knob transform 460ms `--ease-jelly`;
- knob stretches from 16px to 20px while pressed, radius 50% to 8px;
- the track background crossfades; no sliding color wash.

Section expand:
- keyframes: height 0, opacity 0; height 103.5%, opacity 1 at 72%; height 100%, opacity 1;
- 760ms `--ease-jelly`;
- close: 100%, 94%, 0; 500ms `--ease-drawer`.

## 8. WebGL

A shader is allowed only as meaning, not as atmosphere. One shader, one job.

Rules:
- The effect is bound to state: running, writing, error. If state does not change, the effect is not needed.
- One context, one canvas, no libraries.
- Render at half resolution and scale bilinearly. This gives soft light and low load.
- The canvas has `pointer-events: none`, sits under content, and never intercepts clicks.
- Pause when the tab is hidden and when the canvas is out of view, via `IntersectionObserver`.
- `prefers-reduced-motion` draws one static frame and stops the loop.
- No WebGL, no canvas. The interface works without it.
- Goo is SVG, not WebGL. It does not count as the one WebGL effect, and it never becomes a full-screen layer.
- Do not use dither, particles, a full-screen fluid, cursor light outside a control, or 3D tilt.
- A glow must not extend beyond its semantic block. Leave 20-30px on the sides for falloff so the edge is not cut.
- A glow must not wash out text. If text sits under the glow, alpha drops to 0.12-0.16.

Components live in `ui/src/components`, state and pure helpers in `ui/src/lib`, demo data in `ui/src/lib/demo.ts`.

Current example: the live status. Canvas is the row width plus 48px, 80px tall, centered on the row. A slow domain-warped fbm in the shared iris accent, alpha around 0.15, 24px edge falloff. The pulse is synced with the dot.

## 9. Components

Composer:
- no border;
- background `#1d1d1d`, radius 18px;
- 1px top highlight, 6% white;
- a 56px mask above it so content dissolves into the background;
- focus: 1px accent ring plus radius 18 to 22, no size jump;
- no decorative underline, dot, or goo line inside the composer;
- send: accent gradient, 38% top highlight, 18% bottom bevel, 1px outer shadow, hover radius 8 to 10, arrow to stop morph;
- press: global spring, never a hard scale flip.

User message:
- no bubble;
- aligned right;
- 2px accent line on the left, drawn from the top with scaleY;
- max-width 85%;
- body 16px in the body color;
- entrance is a jelly lift, no blur.

Live status:
- no pill and no border;
- a goo dot with a satellite, label, meta;
- the satellite merges with the dot through `#goo-tight`, the text stays outside;
- glow matches the row width exactly, no wider and no narrower;
- 24px falloff on each side;
- glow height 80px;
- on stop the status and glow disappear; on completion the status becomes "done".

Toast:
- no border;
- 8% white ring, 8/24 shadow, top highlight;
- text 12.5px;
- jelly entrance, no blur on text;
- never covers the composer.

Reasoning:
- sits above the actions of its turn, inside the run details left border;
- two states: live and closed, plus an opened view after completion;
- live: the header says "Думаю", the body stays open, follows the newest lines and stops at 208px; the top edge fades when text overflows;
- completion collapses the block into one header line: "Думал" plus the turn duration when it is known;
- click opens a 208px viewport that starts at the first line and scrolls inside; both clipped edges fade;
- click again collapses it; a new live turn always starts open;
- header toggle with the same chevron as a run or tool row;
- one block per turn, independent state, kept after the run finishes.

Tool call progress:
- while the model writes tool arguments, show the tool name and a partial path, command or pattern under the live status;
- multiple calls show as separate rows;
- the final action replaces the progress rows as soon as `message.finished` arrives.

Sections:
- chevron 460ms jelly;
- height and opacity 760/500ms with a 3.5% overshoot on open;
- a repeat click cancels the animation instead of queueing it.

Tabs:
- one goo layer, main pill plus a trail of the same shape;
- active text is the static cue;
- the pill stretches between tabs, it does not fade out and in;
- the count pops with `{#key count}`, 420ms.

Sidebar:
- the active task uses one measured goo indicator, not a background per row;
- the indicator scrolls with the list and updates after the list or viewport changes;
- hover is a soft radius lift, not a hard fill;
- the new task button springs its plus; it has no goo;
- the active row stays transparent so the indicator reads.

Model dropdown:
- picker enters as a jelly card from the bottom left;
- rows cascade 18ms, capped;
- the chevron rotates, the active row keeps its accent tint;
- the search field stays a normal input, no goo on text.

Copy:
- copy turns into a check on the same button, 1400ms hold;
- the toast still confirms, but the local morph is the fast cue;
- the button springs on press and never changes width.

## 10. Copy

- The interface supports English, Simplified Chinese, Brazilian Portuguese, Spanish, Japanese, Ukrainian and Russian. English is the default. Names are short and literal. Use ordinary native phrasing and the shared message catalogs; keep the interface language separate from agent replies.
- Do not write UI copy in system-prompt style: no "as an AI assistant", no "I can help", no "let us build".
- Do not use em dashes in docs or UI.
- Do not use filler words: "premium", "seamless", "elegant", "cinematic", "Awwwards-level". Describe the mechanism.
- Numbers are concrete: 5s, 80ms, 240ms, 2.2s. Not "fast" or "smooth".
- A playful interface does not need playful copy. No "boing", "wow", "magic", no exclamation marks, no emoji.
- A mock scene is labeled as a mock. A fixed answer is not presented as model output. The current desktop demo carries a `демо` tag in the titlebar.
- An error states the cause and the next step. No drama, no lecture. Errors never bounce.

## 11. Bans

Do not add:
- glass with blur across the interface;
- gradient text;
- particles and confetti;
- light that follows the cursor outside a control;
- magnetic buttons and cards tilting with the mouse;
- a full-screen liquid, dither, or noise "for wow";
- more than one WebGL effect;
- more than one goo filter on the same control;
- goo on a container that holds text, code, or numbers;
- goo on a scrolling list or on the whole app;
- a translucent source color inside a goo filter;
- an animated width or height outside measured indicators and expand/collapse;
- a second font;
- a new dependency for a visual effect;
- `transition: all`;
- `scale(0)`;
- `ease-in` on entrances;
- large outer glows;
- pure black;
- shadows instead of structure;
- the same goo on every hover;
- an effect that works only in motion and has no static cue;
- bounce on an error, a warning, or a destructive confirmation.

## 12. Self-check

Before shipping, answer:
- How many accent spots are on screen? If more than the allowed roles, remove the weakest.
- How many structural lines are in the main grid? More than two, remove.
- Where does the eye go first? If it goes to the frame or the background, redo.
- Is text readable under the glow? If not, lower the alpha.
- Does every state have a static signal? If not, add one.
- Is any text inside a goo filter? If yes, move the filter to a shape layer.
- Is the goo source alpha near 1? If not, use a solid color and put opacity on the layer.
- How many goo filter regions are visible at once? More than one per control means the effect is decoration.
- Does the goo survive at 1180x640 and with a long Russian label? If it clips, reduce the padding or the trail lag.
- What happens with reduced motion? If anything blinks, waits, or follows the pointer, fix it.
- What happens at 1180x640? If anything clips, fix it.
- Is any animation impossible to interrupt? If yes, redo it.
- Can this be simpler? If yes, simplify.

## 13. Process

- Decide from context without asking when the answer is already in the files.
- Read the code and the states first, then choose.
- Verify every visual change live in a browser at 1480x940 and 1180x640.
- Check states: hover, focus, active, empty, loading, stopped, reduced motion.
- Check the middle of a transition, not only the end state. The goo is visible only while pieces move.
- Take before and after screenshots for visible changes.
- "Done" means verified. Not verified means not done.
- After edits: `bun test`, `bun run check`, `bun run lint`, and `bun run build:ui` for the interface.
- Do not expand scope or change neighboring surfaces without an explicit request.
- A new dependency requires a decision record.

# Part II. Detailed rules

Эти разделы расширяют правила основной части. При конфликте выигрывает основная часть.

## 1. Типографика

Типографика делает две работы: задаёт иерархию и создаёт материал. Нативное ощущение даёт не гарнитура, а роли, интерлиньяж и ширина строки.

### Роли важнее размеров

| Роль | Размер | Line-height | Tracking | Вес | Где |
|---|---|---|---|---|---|
| Micro / meta | 11–12 | 1.3–1.4 | +0.01em | 500 | счётчики, метки, время |
| UI | 13–15 | 1.25–1.35 | 0 | 400–500 | кнопки, строки, табы |
| Reading | 16–18 | 1.5–1.65 | 0 | 400 | тред, длинный текст |
| Section | 18–22 | 1.2–1.3 | −0.01em | 600 | заголовки панелей |
| Page title | 24–32 | 1.1–1.2 | −0.02…−0.03em | 500–600 | заголовок задачи |
| Data / code | 12–14 mono | 1.4–1.5 | 0 | 400 | пути, diff, числа |

**Шкала.** Для плотного desktop хватает коэффициента 1.125–1.2. Для продуктового интерфейса 1.2–1.25. Не добавляйте 18, 22, 26 и 30 одновременно. На экране должно быть не больше четырёх размеров.

**Иерархия.** Стройте её на весе, размере и оптической плотности, не на цвете. Заголовок ярче тела, тело ярче меты. Три веса достаточно: 400, 500, 600. Manrope на 30px с весом 500 читается лучше, чем с 700.

**Регистр.** Sentence case. Капс в русском интерфейсе запрещён: у прописных нет выносных элементов, форма слова исчезает, а строка читается как крик. Если метке не хватает веса, добавьте 500 или 600, а не капс.

**Курсив.** Не используйте фальшивый курсив. У Manrope нет истинного italic, а `font-synthesis: none` уже стоит. Для акцента есть вес, размер и прозрачность.

**Строка.** Для чтения держите 60–75ch, для интерфейсного текста 35–50ch. При 16px это примерно 520–620px в зависимости от шрифта. В `liquidharness` центр занимает около 510px на 1180 и 660px на 1480. На 1480 ограничьте сам текст до 65ch, а не растягивайте его на всю колонку.

**Интерлиньяж.** `line-height` без единиц. Тело 1.5–1.65, заголовки 1.15–1.3, UI 1.25–1.35. Чем длиннее строка, тем больше воздуха: добавляйте около 0.1 к line-height на каждые 10ch выше 65.

**Трекинг.** Тело 0. Заголовки от −0.01 до −0.03em. Капс требует +0.05…+0.12em, но капс вам не нужен. Никогда не разряжайте кириллицу в теле: слово перестаёт узнаваться по форме.

**Переносы.** `text-wrap: balance` для заголовков до шести строк, `text-wrap: pretty` для абзацев. `text-align: justify` не использовать. `hyphens: auto` с `lang="ru"` только для узких колонок и длинного текста, не для кнопок и заголовков. `overflow-wrap: break-word` для путей и идентификаторов. `white-space: nowrap` для бейджей и коротких меток.

**Обрезка.** Многоточие допустимо, если полное значение доступно в tooltip или раскрытом виде. Для путей используйте обрезку в середине, а не в конце: имя файла важнее начала пути.

**Цифры.** `font-variant-numeric: tabular-nums` уже стоит глобально, это правильно. Числовые колонки выравнивайте вправо, единицы держите через неразрывный пробел, разделители разрядов используйте одинаково во всём продукте.

**Шрифт и загрузка.** `woff2`, раздельные `unicode-range` для кириллицы и латиницы уже есть. Добавьте `preload` для кириллического файла и метрики fallback-шрифта, чтобы не было сдвига при загрузке. У Manrope нет оси `opsz`, поэтому `font-optical-sizing` ничего не изменит. Трекинг на крупных размерах задавайте вручную. Не используйте `font-variation-settings` там, где работает `font-weight`.

**Тёмная тема.** Светлый текст на тёмном фоне выглядит жирнее. Держите 400, не спускайтесь в 300. Чистый белый не нужен: `#f0efed` уже даёт мягкий контраст. На тёмном фоне `-webkit-font-smoothing: antialiased` делает текст тоньше, поэтому веса 300–350 почти всегда проваливаются.

**Русская специфика.** «Ёлочки», неразрывные пробелы после односложных предлогов и союзов, между числом и единицей, между инициалами и фамилией. Длинное тире в этом проекте запрещено, поэтому перестраивайте фразу через двоеточие, точку или запятую. Капс не использовать. Переносы только там, где они не ломают смысл.

**Антипаттерны.** 16px везде, 300 вес на 12px, низкий контраст меты, центрированный длинный текст, разряженное тело, фальшивый курсив, пять размеров на одном экране, заголовок капсом.

**Чек-лист.** На экране не больше четырёх размеров и трёх весов. Тело не ниже 15px, мета не ниже 11px, лучше 12px. Длина строки в пределе 65ch. Заголовки с `balance`, абзацы с `pretty`. Цифры табличные. Полное значение обрезанного текста доступно.

## 2. Спейсинг

Спейсинг делает структурную работу: расстояние говорит, что связано, а что нет. Красивая сетка не спасает, если все промежутки одинаковые.

### Шкала

| Токен | px | Где |
|---|---|---|
| 2 | оптическая поправка | иконка к тексту, focus ring |
| 4 | attached | метка и значение, иконка и текст |
| 6 | attached+ | иконка в кнопке, плотная строка |
| 8 | associated | label и input, заголовок и мета |
| 12 | grouped | поля, строки списка, внутренности карточки |
| 16 | grouped+ | padding карточки, внутренности панели |
| 20 | separated | группы полей |
| 24 | separated+ | padding панели, разрыв секций |
| 32 | sectional | крупные блоки |
| 40–48 | sectional+ | регионы страницы |
| 64–80 | display | пустые состояния, онбординг |

**Две оси.** `inset` это пространство внутри компонента, `gap` это расстояние между соседями. Не используйте один токен для обоих. Кнопка объявляет свой padding, список объявляет свой gap. Так компонент сохраняет плотность в любом контексте.

**Порядок отношений.** Attached 2–4, associated 6–8, grouped 8–12, separated 16–24, sectional 32–48. Если зазор между label и input больше, чем между полями, форма рассыпается. Если зазор между полями больше, чем между секциями, секции слипаются.

**Внутри меньше, чем между.** Дочерний gap не может быть шире родительского. Иначе группировка читается наоборот. Это одна из самых частых ошибок в плотных интерфейсах.

**Три уровня минимум.** Одинаковые 16px везде дают плоскость. На экране должно быть хотя бы три разных расстояния: внутри, между, между секциями. Пользователь должен видеть группы, если прищуриться.

**Сетка.** База 4px, ритм 8px. 2px только для оптики. 6 и 10 допустимы как внутренние полушаги компонента, но не как шаг страницы. Значения 18, 22, 30 не должны становиться системой. Если 10 и 18 уже есть в токенах, держите их как локальные исключения.

**Плотность.** Compact: строки 28–32, контролы 28–32, панели 16–20, страница 24–32. Comfortable: строки 36–40, контролы 32–36. Spacious: 48+. Плотность меняет токены по контексту, а не одним глобальным множителем. Навигация, таблица и текст могут жить в разных режимах.

**Воздух раньше рамки.** Сначала попробуйте расстояние, потом линию, потом карточку. Container fatigue начинается там, где каждая группа лежит в своей коробке. В плотном инструменте это быстро превращается в шум.

**Оптика.** `line-height` уже создаёт визуальный padding вокруг текста, не добавляйте к нему ещё margin сверху и снизу. Иконка и текст: 6–8px. Кнопка с иконкой: на 2px меньше padding со стороны иконки. Залитые иконки опускайте на 1px, треугольники поднимайте на 1–2px.

**Вертикальный ритм.** Единица ритма это line-height тела. Отступы держите кратными 4/8. Не гонитесь за буквальной baseline grid: при разных размерах и вложенных padding она всё равно ломается. Важнее повторяемый шаг, чем математически идеальная линия.

**Адаптивность.** Для page padding используйте `clamp()`, но не сжимайте gap ниже 8px. Хит-зоны не меньше 40×40 на десктопе и 44×44 на тач. На 1180×640 проверяйте, что центр не стал слишком узким.

**Текущая сетка.** 48px titlebar, sidebar 270–300, panel 500–700. Центр гибкий, остальное фиксировано. На 1180 sidebar становится 250, panel 420, центру остаётся около 510px. Не добавляйте туда page padding 32px с обеих сторон, иначе останется 446px.

**Антипаттерны.** 24px padding в плотном инструменте, карточки в карточках, одинаковые gaps, отрицательные margin вместо сетки, значения 18/22/30 как система, `margin` вместо `gap`, воздух, который съедает рабочую область.

**Чек-лист.** На экране три уровня расстояний. Внутри меньше, чем между. Ни одного off-grid значения вне токенов. Плотность соответствует рабочей задаче. Хит-зоны не меньше 40px. На 1180×640 ничего не сжалось в ноль.

## 3. Лэйаут

Лэйаут в нативном приложении это сцена с иерархией, а не сетка равных карточек. Сначала решается, что главное, потом как это разложить.

### Регионы

| Регион | Размер | Роль |
|---|---|---|
| Titlebar / toolbar | 38–52 | окно, заголовок, глобальные действия |
| Sidebar | 220–320 | навигация, проекты, список |
| Content | 480–720 | основная работа |
| Inspector | 250–360 | свойства, контекст, детали |
| Status | 24–28 | состояние, счётчики, фон |
| Rows | 24–32 | списки и таблицы |

**Один главный регион.** Контент доминирует, chrome отступает. Sidebar темнее, рабочая поверхность светлее. Один лист, максимум два шва. Если швов больше, интерфейс начинает выглядеть как набор панелей.

**Правильная поверхность.** Страница для навигации. Split view для master-detail. Inspector для свойств выделенного объекта. Sheet для задачи, которая прерывает поток. Popover для контекстного действия. Палитра для команд. Не решайте задачу модалкой, если десктоп ждёт отдельное окно или панель.

**Одна ось чтения.** Левое выравнивание, один левый край, один правый. Длинный текст не центрировать. Действия держите рядом с объектом, к которому они относятся. Порядок чтения: sidebar, контент, inspector.

**Ширина контента.** 60–75ch. В `liquidharness` центр на 1180 даёт около 510px, на 1480 около 660px. Это рабочий диапазон, но текст внутри всё равно ограничьте 65ch и отдайте остаток воздуху.

**Сетка и intrinsic sizing.** Grid для страницы, flex для компонентов. `minmax(0, 1fr)` обязателен, иначе длинный текст распирает колонку. `subgrid` помогает выровнять строки между карточками. Container queries позволяют компоненту перестраиваться в узком sidebar, а не по ширине окна.

**Адаптивность как структура.** Wide: sidebar + content + inspector. Medium: sidebar + content, inspector становится overlay. Narrow: одна колонка плюс drawer или табы. Не сжимайте три колонки до двух пикселей. Меняйте режим, сохраняя контекст.

**Resizable panels.** Минимумы обязательны: sidebar 220–260, content 320–420, inspector 220–280. Ручка 8–10px, двойной клик сбрасывает, размер запоминается. Разделитель должен работать с клавиатуры. Если сумма минимумов не влезает, меняйте режим, а не позволяйте панелям перекрываться.

**Скролл.** Один владелец скролла на регион. Не делайте вложенный скролл в панели, которая уже внутри скроллящегося контента. Липкий toolbar, scroll edge effect под ним, сохранение позиции при переключении таба и возврате. Иначе интерфейс теряет место.

**Движение и лэйаут.** Переход между состояниями делайте через shared element, FLIP или View Transitions. Сначала анимируйте `transform`. Ширина inspector может менять `grid-template-columns` за 720ms с `--ease-goo`, но контент внутри обязан обрезаться, а `visibility` переключается после завершения.

**Доступность.** DOM-порядок совпадает с визуальным. Landmarks, фокус по порядку, возврат фокуса после закрытия слоя. При 200% zoom и ширине 320px интерфейс перестраивается, а не обрезается. Хит-зоны 40–44px.

**Органика в лэйауте.** Асимметрия с порядком: один главный блок, один поддерживающий, сетка underneath. Форма следует за содержимым: панель растёт из контента, а не из фиксированной карточки. Кривые сверху, сетка снизу. Одна неровность на экран, и только там, где её нельзя принять за баг.

**Антипаттерны.** Центрированный лендинг в инструменте, hero-заголовок, три равные карточки, карточки в карточках, фиксированные высоты, текст на всю ширину, настройки в модалке, попапы, обрезанные окном, отсутствие минимальных ширин, горизонтальный скролл на 1180.

**Чек-лист.** Один главный регион и один фокус. Не больше двух швов. Текст не шире 75ch. Все панели имеют минимумы. Один владелец скролла на регион. На 1180×640 и при 200% zoom ничего не перекрывается.

## Практические выводы для liquidharness

- База 15px и тело треда 16px уже в хорошем диапазоне. Не опускайте UI ниже 13px, мету ниже 11px, а для кириллицы держите мету на 12px.
- Заголовок 30px с tracking −0.03em уже настроен. Добавьте `text-wrap: balance` для заголовков и `pretty` для абзацев.
- При 16px центр 510–660px даёт примерно 62–80ch. Ограничьте текст до 65ch внутри колонки.
- Панель 500–700px это скорее вторая рабочая колонка, чем инспектор. Если там diff и terminal, это оправдано. Если свойства, 280–360px будет ближе к нативному поведению.
- Sidebar 270–300 и titlebar 48px попадают в диапазоны macOS. На 1180 sidebar сжимается до 250, это нормально.
- В `app.css` spacing-токены уже есть. Используйте их, иначе 10/18/24 снова расползутся по компонентам.
- Один breakpoint на 1220px мало. Для ширины ниже 1100px нужен структурный режим: скрыть inspector или sidebar, а не сжимать три колонки.

**Источники**

- Apple HIG, Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Apple WWDC20, The details of UI typography: https://developer.apple.com/videos/play/wwdc2020/10175/
- Microsoft, Typography in Windows: https://learn.microsoft.com/en-us/windows/apps/design/style/typography
- Material 3, Type scale tokens: https://m3.material.io/styles/typography/type-scale-tokens
- USWDS, Typesetting: https://designsystem.digital.gov/design-tokens/typesetting/overview/
- Typography Handbook: https://typographyhandbook.com/
- web.dev, Typography: https://web.dev/learn/design/typography
- MDN, `text-wrap`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/text-wrap
- Atlassian, Spacing: https://atlassian.design/foundations/spacing/
- Wayflyer, Spacing: https://design.wayflyer.com/latest/design-system/specifications/spacing/overview-f4M6Dk8t
- Marigold, Spacing: https://www.marigold-ui.io/foundations/spacing
- Human Standards, Spatial rhythm: https://www.humanstandards.org/code-design-tokens/spatial-rhythm-layout/
- Astryx, Design conventions: https://github.com/facebook/astryx/wiki/Design-Conventions
- macOS layout metrics reference: https://github.com/yigitkonur/skills-by-yigitkonur/blob/main/skills/apply-macos-hig/skills/apply-macos-hig/references/foundations/03-layout-spacing-and-alignment.md
- Windows title bar: https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design
- Kontur, Экранная типографика: https://guides.kontur.ru/principles/text/typography/
- Richtypo, Russian rules: https://github.com/sapegin/richtypo.js/blob/main/docs/rules/RussianRules.md

# Part III. Playful, liquid, morphic

Этот раздел фиксирует направление, которое ввели после первой версии: интерфейс должен быть игривым, жидким и морфичным, но оставаться рабочим инструментом. Опора: Playful UI yui540 и подход Gooey. Формула Gooey: касающиеся части сливаются как желе и меняют форму, пока текст остаётся резким.

## 1. Что значит играть

Игривость здесь не означает декор, эмодзи, конфетти или «весёлые» подписи. Она означает физику:

- у элемента есть масса, он продавливается и возвращается;
- у перехода есть подготовка, движение и остановка;
- две части, коснувшись, на секунду становятся одной;
- рутинный клик превращается в короткую сцену;
- интерфейс хочется нажать ещё раз, но работа от этого не замедляется.

Playful UI нужен не вместо смысла, а поверх смысла. Сначала пользователь понимает состояние, потом получает удовольствие от того, как оно сменилось.

## 2. Четыре принципа

1. **Тактильность.** Кнопка, тумблер и строка списка ощущаются как предметы с объёмом. Нажатие всегда даёт быстрый отклик, отпускание даёт пружину.
2. **Микросюжет.** Смена состояния разыгрывается, а не переключается кадром. Галочка выпрыгивает, вкладка перетекает, копирование становится галочкой, панель выезжает с ускорением.
3. **Покадровая кривая.** Анимация строится как в моушн-графике: anticipation, overshoot, settle. Кривые важнее длительности. Пружина на 460ms читается лучше линейного перехода на 700ms.
4. **Радость повторения.** Если нажать второй раз так же приятно, механика удалась. Если второй раз раздражает, это аттракцион, а не интерфейс.

## 3. Контракт Gooey

### Фильтр

Два калибра SVG-фильтра живут в `GooFilters.svelte`. `#goo` для фигур 18px и больше, `#goo-tight` для мелкой live dot.

```html
<filter id="goo" x="-30%" y="-30%" width="160%" height="160%"
  color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
  <feColorMatrix in="blur" mode="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" />
</filter>

<filter id="goo-tight" x="-40%" y="-40%" width="180%" height="180%"
  color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
  <feColorMatrix in="blur" mode="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
</filter>
```

`feGaussianBlur` размывает альфу, `feColorMatrix` возвращает ей жёсткий порог. Две близкие фигуры получают общий контур. Чем больше `stdDeviation`, тем сильнее слияние и тем важнее размер фигур. 5px работает для контролов 18-48px. Для диска 5-7px нужен `#goo-tight`, иначе порог съедает форму.

Один контрол использует один калибр. Два фильтра на одной кнопке не ставятся. Переключение между калибрами это смена масштаба эффекта, а не декоративный слой.

### Альфа

Внутри фильтра источник должен быть почти непрозрачным. Матрица `19 -8` убивает альфу ниже примерно 0.42. Поэтому:

- фигура внутри goo всегда залита solid-цветом;
- прозрачность ставится на контейнер фильтра, а не на `background` фигур;
- для мягкого тона цвет сначала смешивается с фоном вручную, а не задаётся через `rgba`;
- низкая alpha на самой фигуре даёт пустоту, а не деликатный оттенок.

### Текст

Текст никогда не находится внутри элемента с `filter: url(#goo)`. Фильтр применяется только к отдельному слою фигур. Текст, цифры и код лежат выше, обычно через `position: relative` и `z-index: 1`. Это не оптимизация, это правило продукта: Gooey существует ради резкого текста.

### Триггер

Goo это ответ на касание или на смену состояния, не фон:

- переключение вкладки;
- смена активной задачи;
- живой статус.

На кнопках goo нет. Индикаторы вкладки и активной задачи остаются как статическая форма. Статический сигнал всегда даёт цвет, иконка или текст.

### Границы

- Один фильтр на контрол. Два фильтра на одной кнопке это уже эффект ради эффекта.
- `pointer-events: none` на слое.
- `aria-hidden="true"` на слое.
- `prefers-reduced-motion` отключает goo-анимации и оставляет статические индикаторы.
- Goo не ставится на скроллящийся список, на весь экран или на контейнер с текстом.
- При сомнении уменьшайте радиус и площадь, а не яркость текста.

## 4. Физика

Словарь, которым пользуемся в коде и ревью:

- **Squash:** сжатие по одной оси и растяжение по другой. Нажатие кнопки: `scale 0.93`, затем `1.028`, затем `1`.
- **Anticipation:** короткий уход в обратную сторону перед движением. Нужен редко, в основном для крупных панелей.
- **Overshoot:** проход на 1-3.5% дальше цели. Больше 4% уже выглядит как ошибка раскладки.
- **Settle:** возврат с затуханием. Пружина не должна звенеть дольше 600ms.
- **Follow-through:** хвост, который догоняет. В goo это второй слой, который едет медленнее pill.
- **Merge:** две фигуры соединяются через общий контур. Вкладки и активная задача.
- **Morph:** смена формы без разрыва. Стрелка в стоп, копирование в галочку, радиус кнопки в покое и на hover.
- **Wobble:** медленное изменение border-radius у живого индикатора. Только для live-статуса, не для текста.

Правило: одна сцена, одна пружина. Не складывайте bounce, glow, wobble и goo в одном месте.

## 5. Карта паттернов

16 паттернов из подборки yui540, переложенные на текущий интерфейс. Если сценария нет, паттерн не добавляется.

| Паттерн | Где в Flecten | Механика | Время |
|---|---|---|---|
| Кнопки | send, icon buttons, task row, settings | press spring, radius lift; no hover goo | 460ms |
| Вкладки | inspector | pill и trail той же формы, слияние между табами | 480/720ms |
| Счётчик | tab count, check group count | digit pop через `{#key}` | 420ms |
| Режим отображения | нет переключателя list/grid | не добавлять без сценария | - |
| Подписка / follow | copy button | copy morph to check на 1400ms | 620ms |
| Прогресс | run details, checks | expand с 3.5% overshoot, check pop | 760ms |
| Меню | settings, new task | settings gear turns, new task plus springs | 460ms |
| Тултип | native `title` | не делать кастомный тултип без нужды | - |
| Скачивание | нет действия | не добавлять | - |
| PiP | panel toggle | иконка сдвигается, панель выезжает | 720ms |
| Селект | model picker | jelly card, cascade rows, chevron flip | 520ms |
| Hover-превью | file chip, task row | radius lift, no pointer goo | 260ms |
| Плюс / минус | new task plus | plus springs on hover, press spring on click | 460ms |
| Светлая / тёмная тема | тема одна | не добавлять лампу ради метафоры | - |
| Вкладки окна | window controls | press spring and radius lift; no rotation on symmetric icons | 460ms |
| Дата | нет выбора даты | не добавлять | - |

## 6. Где это живёт

- `ui/src/app.css`: токены, press keyframes, reduced motion.
- `ui/src/lib/motion.ts`: `installPressFeedback`, `expandable`, `enterPane`.
- `ui/src/components/GooFilters.svelte`: сам SVG-фильтр.
- `Composer.svelte`: focus radius и caret.
- `ComposerBar.svelte`: send morph и press spring.
- `InspectorPanel.svelte`: tab goo и измерение позиции.
- `Sidebar.svelte`: активная задача как один общий индикатор.
- `LiveRun.svelte`: goo dot и satellite.
- `RunGroup.svelte`, `ChecksPane.svelte`, `CheckRow.svelte`: check pop, live morph, copy.
- `ModelPicker.svelte`: jelly card и cascade.
- `ui/src/controls.css`, `settings-surface.css`: shared controls, switch, dialog, details.

## 7. Бюджет

- На экране одновременно не больше одного активного goo-фильтра на контрол. Скрытые слои не анимируются.
- Goo вешается на маленькие фигуры. Большой goo на весь composer или панель запрещён.
- Один WebGL по-прежнему. Goo это SVG и не считается вторым шейдером.
- Ни одной новой зависимости. Всё на CSS, SVG и Web Animations API.
- Индикаторы вкладок и задач измеряются после `tick()` и на `ResizeObserver`. Не читайте layout в цикле анимации.
- На 1180x640 гоу не выходит за хит-зону и не перекрывает текст. Проверяйте длинные русские подписи.
- Reduced motion: без goo-анимаций и без шейдера. Статические индикаторы, цвет и текст остаются.
- Контраст текста не меняется ни в одном состоянии. Goo живёт под текстом, не над ним.

## 8. Тон

- Игривость в физике, не в копирайте. Никаких «бум», «вау», «магия», восклицательных знаков и эмодзи.
- Микросцена должна объяснять состояние: галочка говорит «готово», стоп говорит «идёт», goo на вкладке говорит «активно».
- Ошибка не прыгает и не блестит. Ошибка спокойно сообщает причину и следующий шаг.
- Если анимация не помогает понять состояние, она не нужна.

## 9. Чек-лист

- Текст остаётся резким в каждом состоянии.
- У каждой сцены есть статический сигнал.
- Пружина отпускания короче 600ms.
- Нет двух goo-фильтров на одном контроле.
- Нет goo на контейнере с текстом.
- На rest кнопки не имеют постоянных пятен.
- Reduced motion отключает goo-анимации и шейдер.
- На 1180x640 и 1480x940 ничего не клипается.
- Повторное нажатие прерывает старую анимацию, а не ставит её в очередь.
- Новая зависимость не появилась.

## Источники Part III

- yui540, X: https://x.com/yui540
- yui540, portfolio: https://yui540.com
- yui540, GitHub: https://github.com/yui540
- Gooey: Liquid UI for React. Формула: касающиеся части сливаются, текст остаётся резким.
- Zenn, разбор Playful UI и экономики микродеталей. Автор: Shunta Furukawa.
