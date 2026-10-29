# Motion and design system

Covers `css/tokens.css`, `css/dark.css`, `css/base.css`, `css/layout.css`, `css/components.css`,
`css/animations.css`, `css/pages.css`, `js/core/anim.js` and the overlay parts of `js/core/ui.js`.
Live examples: `#/styleguide` (dev hosts only: localhost, 127.0.0.1, `*.localhost`).

## Principles

- **Transform and opacity only.** Everything moves with `transform` and `opacity`, so it runs on the compositor and stays at 60fps.
- **Documented exceptions**, all decorative and short: `blob-morph` (border-radius of the empty-state blob), `draw-line` (SVG stroke for the ECG line, chart lines and the success check), `bar-slide` (loading bar position), `flash-ok` (colour flash of the synced pill), and count-up text.
- **Reduced motion** swaps motion for fades. The OS setting (`prefers-reduced-motion`) and the styleguide toggle (`html.reduce-motion`) both count. Loops, sweeps and magnetic or tilt effects stop.
- **No blur filters on large or animated elements.** `backdrop-filter` is used on the header, bottom bar, sidebar, dialogs and glass cards only. Solid fallbacks apply where it is unsupported.

## Tokens

| Group | Tokens |
|---|---|
| Brand | `--c-brand-start` (#047857), `--c-brand-end` (#0f766e), `--grad-brand`, `--shadow-glow-brand` |
| Neutrals | `--n-0` … `--n-900` (`--c-*` are semantic aliases) |
| Semantic | `--c-ok`, `--c-warn`, `--c-danger`, `--c-info` with `-soft` tints |
| Feature accents | `--accent-{green,blue,orange,teal,purple,cyan,pink,amber}` with `-grad`, `-glow`, `-soft` |
| Radius | `--radius-xs` 6, `--radius-sm` 8, `--radius` 12, `--radius-lg` 16, `--radius-xl` 24, `--radius-pill` |
| Shadow | `--shadow-1`, `--shadow-2`, `--shadow-3` (layered, colour-tinted), `--shadow-glow-brand` |
| Space | `--space-1` … `--space-12` on a 4px grid |
| Type | `--fs-xs` … `--fs-3xl` (fluid `clamp()`), `--font-latin` (Inter), `--font-urdu` (Noto Nastaliq Urdu), `.money` for tabular digits |
| Easing | `--ease-out-expo`, `--ease-in-out`, `--ease-spring` (`linear()` spring where supported, cubic fallback) |
| Duration | `--d-1` 80ms, `--d-2` 160ms, `--d-3` 240ms, `--d-4` 400ms, `--d-5` 700ms |

Fonts are self-hosted in `fonts/` (Inter 400/500/600/700, Noto Nastaliq Urdu 400), so they work offline. The Urdu face loads only when Urdu text is shown.

Dark mode follows the device unless `data-theme` is set (`light`, `dark` or `auto`). `dark.css` holds three blocks that redefine the same tokens: keep them in sync.

## Data attributes (markup)

| Attribute or class | Effect |
|---|---|
| `data-anim="rise"` on a container | Its children rise in one after another (45ms apart, first 12). Runs after each page render, via `anim.prepare()`. |
| `data-count="1234" data-format="money\|money-plain\|int\|percent"` | Counts up to the value. Money is in paisa. Re-count with `anim.countUp(el, value, {format})`. |
| `data-magnetic` | Primary action drifts toward the pointer (fine pointers only). |
| `.tile` + `data-accent="green\|blue\|orange\|teal\|purple\|cyan\|pink\|amber"` | Feature tile: tilts toward the pointer, shine sweep on hover, press scale. |
| `.seg` > `.seg-indicator` + `.seg-option[aria-checked]` | Segmented control. The pill slides to the active option on click. |
| `.tabs` > `.tab-indicator` + `.tab[aria-selected]` | Tabs. The underline slides on click. |
| `data-key="…"` on children of a list | FLIP: use `anim.flip(list, mutate)`. Children glide to new positions; new children fade in. |
| `data-label="…"` on `td` in `table.table-cards` | On phones the table becomes cards, with the label shown before each value. |
| `data-tip="…"` | Tooltip that scales in from its origin on hover or focus. |
| `.btn` with `[data-label-hide]` inside | Loading and success states hide the label (`buttonState`). |
| `.float-field` > `input` + `label` (+ `.tick` svg) | Floating label with an animated focus ring. `.is-valid` draws the tick. `.is-invalid` shakes (`anim.markField`). |
| `.check`, `.switch` | Checkbox ticks itself. Switch thumb stretches while pressed. |
| `.chart` > `.chart-bar` (`--h`, `--i`, `data-value`) | Bars grow from the baseline with a stagger. |
| `svg path` with `pathLength="1"` in `.chart-line` | Line draws itself. |
| `.hero` > `.capsule`, `.hero-ecg` | Hero banner: drifting mesh, floating capsules, ECG line drawn once. |
| `.status-pill.is-syncing` / `.is-synced` | Pulses while changes are waiting to sync, flashes green when all are sent (set by `app.js` from the sync backlog). |
| `.bottom-link--center` | The centre Sell button, raised, with a breathing ring. |
| `.nav-indicator` (sidebar) | Sliding highlight behind the current item. Set by `app.js`. |
| `.skeleton`, `.skeleton-line`, `.skeleton-card` | Shimmer placeholders. `ui.skeleton(n)` returns markup. |
| `.empty-blob` | Dashed morphing blob for empty states. `ui.emptyState({...})` returns the whole block. |

## Animation API (`js/core/anim.js`)

| Function | What it does |
|---|---|
| `reducedMotion()` | True when the OS setting or `html.reduce-motion` is on. |
| `animate(el, frames, options)` | Web Animations wrapper. Capped so navigation never waits on it. Under reduced motion keeps opacity only. |
| `enter(el)` / `leave(el)` | Page transitions: 8px slide and fade. The router calls them. |
| `prepare(root)` | After a page renders: `rise`, `scanCounts` and `syncIndicators`. |
| `rise(root)` | Stagger for `[data-anim="rise"]` children. |
| `countUp(el, to, {format, duration})` | Count-up with a short roll on each change. |
| `scanCounts(root)` | Counts every `[data-count]` inside root. |
| `flip(container, mutate)` | FLIP for `[data-key]` children. |
| `removeWithMotion(el)` | Fade and collapse, then remove. Resolves when removed. |
| `flyToCart(fromEl, toEl)` | Thumbnail arcs from a product to the cart, then the badge pops. |
| `popBadge(el)` | Scale pop, for counters. |
| `shake(el)` | Horizontal shake. |
| `markField(fieldEl, 'valid' \| 'invalid' \| other)` | Tick or shake on a form field. |
| `buttonState(button, 'loading' \| 'success' \| 'idle')` | Spinner, then check, then idle (the check clears after 1.4s). |
| `celebrate({title, lines, total})` | Full-screen success: SVG check draws, receipt slides out, confetti falls. Click or Escape closes it. Returns `close()`. |
| `moveIndicator(container, target)` | Positions a sliding indicator under `target` (RTL aware). |
| `syncIndicators(root)` | Positions every indicator inside root. |
| `install()` | Once at boot: ripple on press, tilt, magnetic hover, and segmented/tab clicks. |

## Overlays (`js/core/ui.js`)

- `openModal({title, body, actions, onClose})`: a centred glass dialog on desktop. On phones it is a bottom sheet with a drag handle: drag it down more than 120px to close.
- `confirmDialog({title, message, confirmLabel, danger})`: resolves `true` or `false`.
- `toast(message, {type, timeout})`: swipe sideways to dismiss. Short swipes spring back.
- `openPalette({source, placeholder})`: the Ctrl+K palette. `source(query)` returns `[{label, hint, run}]` and may be async. Arrow keys move, Enter runs, Escape closes. `app.js` wires it to pages and to medicine search.
- `skeleton(lines)`, `emptyState({...})`: markup helpers.

## Performance budget

- Lighthouse performance on `#/styleguide`, measured with the Lighthouse default (mobile throttling) and a gzip-enabled local server (GitHub Pages also gzips): **90 to 93**. First contentful paint about 2.0s, LCP about 2.8s, CLS 0 to 0.02, TBT about 100ms. Lighthouse on the same machine scores a blank page 100, so the numbers above reflect this app.
- Without gzip the same page scores 73 to 81, because the transfer is about 500 KB. Most of that is jQuery (86 KB), which is needed by the architecture.
- What keeps the score up: no blur filters on large animated surfaces, no `background-attachment: fixed`, no looping box-shadow animations, the Urdu font loaded only on demand, `jquery` deferred from `vendor/`, and `modulepreload` for the boot module graph.

## Deviations from the brief

- jQuery is loaded from `vendor/` (deferred), not cdnjs. The CDN copy added a connection and a blocking fallback before first paint. The vendored copy is the same version (3.7.1).
- The styleguide's labels are plain English, as developer documentation. Every other visible string uses `t()`.
- Not built yet: the collapsible sidebar groups with height animation (the brief's height animation conflicts with the transform-only rule, so it needs a decision), and a Lighthouse run in a real browser on GitHub Pages.
