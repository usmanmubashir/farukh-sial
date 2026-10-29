# Quality pass (version 1.1.0)

What was measured, how to measure it again, and what is still open. Every number below comes from a script in `scripts/` or a page in `tests/`.

## Measured

| Check | Command or page | Result |
|---|---|---|
| First-load JavaScript and CSS (gzip) | `node scripts/audit-budget.mjs` | 145.8 KB, budget 300 KB. The whole app is 258 KB if every route is downloaded. |
| Preload block matches the import graph | same script | 37 modules listed in `index.html` |
| Colour contrast, light and dark | `node scripts/audit-contrast.mjs` | Text pairs 4.5:1 or better in both themes. Field outlines 3:1 (new token `--c-control-border`). |
| Service worker shell list and version | `node scripts/audit-shell.mjs` | 112 files, version 1.1.0 |
| Translation keys | `node tests/audit-keys.mjs` | 810 literal keys, none missing in English or Urdu |
| Schema upgrade from version 1 | `tests/migration.html` | 12 of 12 |
| Services and business rules | `tests/services.test.html` | 339 of 339 |
| Two devices, offline, converge | `tests/sync-sim.html` | 20 of 20 |
| Lighthouse (desktop-like run, Chrome) | Lighthouse 12.6.1 through its API | Accessibility 100, Best Practices 100, SEO 100. Performance 66 to 78 across runs (see open items). |

## Fixed in this pass

- **Content Security Policy** added to `index.html`. It blocks inline scripts, `eval`, and external scripts and styles. Inline `style=""` attributes still need `'unsafe-inline'` in the style policy. Lighthouse found that the first version of the policy had lost its quotes and blocked the app; that is fixed.
- **Inline event handlers removed** from `index.html` (the two `onload` stylesheet hooks). The stylesheets are ordinary links now.
- **Error boundary**: uncaught errors and unhandled promise rejections show one toast per 4 seconds and are written to a local `errorLog` store (schema 5, newest 200, never in backups).
- **Storage full**: a `QuotaExceededError` on a write becomes a `storageFull` error with its own message.
- **Double submit**: a second submit of the same form, or a second click on a primary action within 800 ms, is dropped before any handler runs.
- **Undo**: discarding a held sale and removing a line from the order list both offer Undo in the toast. Both services now return what they removed and can restore it.
- **Search debounce**: nine list pages repaint 150 ms after the last keystroke. The POS search keeps its keyboard flow and is not debounced.
- **Accessibility**: errors announce as alerts. POS totals and the pay-sheet total are polite live regions. A skeleton with `aria-busy` shows while each route renders. The field outline colour now meets 3:1.
- **Motion**: width and height transitions removed from the sliding indicators (they were layout work every frame). Transform and opacity remain. The reduce-motion switch is in Settings → Appearance, stored per device, on top of the device setting.
- **Performance**: a preload block lists every module of the first load, so they download in parallel. Boot runs its two independent reads together, and sync starts in the background.

## Checklist (`tests/e2e-checklist.md`)

40 scenarios. 12 pass, 3 partly, 25 not run in this pass. The 25 include the sale flows (keyboard timing, Rx rules, holds, voids, returns), printing, Bluetooth, camera, backup download, and the restore checks. Each one needs a run by hand, and the checklist says what to do.

## Still open

- **Lighthouse Performance is below 90.** Simulated mobile runs give LCP about 5 s, because the header and the first screen wait for the boot path: IndexedDB reads and module evaluation on a slow CPU. The next step is to measure the boot with a trace and move work off the critical path (for example, lazy translations).
- **Skeletons** cover route loads. Each page's data reads also run inside that window. Pages that load data in a second step after the first paint have no separate skeleton.
- **FLIP** is used in six places. Lists that re-order on filter (most of them) still jump.
- **Hover and focus feedback** exists on the main controls. It has not been checked on every element.
- **Colour transitions**: hover and focus still fade `background`, `border-color` and `box-shadow`. These are paint-only, not transform or opacity. Changing them would remove the button feedback.
- **Escaping** is applied at the HTML sinks that were reviewed (receipts, forms, lists, modals, the sync sheet). A full line-by-line pass over every template in 28 files has not been done.
- **Sync error reasons** from the adapter (for example "No connection to the sync server") are not translated yet.
- **Storage-full** cannot be triggered in a test. The mapping is in place, the message is written, but the path is untested.
- **Service worker in the in-app browser** still cannot register, even a trivial one. Offline start and the update bar are unverified (see `docs/SYNC.md`).
- **Pages still mix** `esc()` and `text()`. Both are safe where they are used; the rule "use `.text()` for user data" is not enforced by a tool.
