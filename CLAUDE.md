You are building "Shifa Pharmacy POS", an offline-first pharmacy management app for Pakistani pharmacies. Create CLAUDE.md in the repo root containing everything below, then follow it for the whole project.

TECH STACK (strict)
- HTML5, CSS3, vanilla JavaScript (ES2020) and jQuery 3.7 (load from cdnjs, but also vendor a local copy in /vendor so it works offline).
- Single Page Application: index.html is the only HTML file. Hash router (#/dashboard etc.). No frameworks, no bundler, no npm build, no TypeScript.
- Everything must run by opening index.html through any static server and deploy to GitHub Pages unchanged.
- Data: IndexedDB (wrapped by a small promise-based helper in js/core/db.js). localStorage only for UI prefs.
- PWA: manifest.webmanifest + service worker (sw.js) that precaches the app shell so the app works with zero connection after the first load.
- Sync: outbox + pluggable adapter (js/core/sync.js), default Supabase REST via fetch.

FOLDER STRUCTURE
/index.html
/sw.js, /manifest.webmanifest, /icons
/css: tokens.css, base.css, layout.css, components.css, animations.css, pages.css, print.css, dark.css
/js/core: db.js, store.js, router.js, events.js, money.js, dates.js, i18n.js, sync.js, auth.js, ui.js, anim.js
/js/services: products.js, stock.js, sales.js, purchases.js, returns.js, parties.js, ledger.js, reports.js, backup.js, printing.js
/js/pages: one file per route
/js/i18n: en.js, ur.js
/vendor: jquery.min.js
/docs: ARCHITECTURE.md, DATA_MODEL.md

ARCHITECTURE RULES
1. Layers: pages (UI) -> services (business logic) -> db (IndexedDB). Pages never touch IndexedDB directly.
2. Every page module exports { route, title, render($root, params), destroy() }. The router mounts/unmounts them with transition animations.
3. All writes go through a single db.transaction() helper that also appends to the outbox store in the same transaction (atomic).
4. Money is stored as integer paisa. Format only at display time via money.js.
5. Stock is NEVER a stored number that is edited directly. Stock = sum of batch quantity movements. Provide recalculateStock() for the "Recalculate stock" button.
6. Every business document (sale, purchase, return, voucher, adjustment) posts balanced ledger entries (double entry) through ledger.js.
7. Documents get sequential numbers with configurable prefixes (SALE-0001, PUR-0001, SRN, PRN, RCV, PAY, TRF, ADJ), safe against multiple devices via a per-device prefix option.
8. i18n: every visible string uses t('key'). Urdu is full RTL, uses the Noto Nastaliq Urdu font, and flips layout via [dir=rtl] and CSS logical properties.
9. Accessibility: keyboard navigable, visible focus, aria labels, prefers-reduced-motion respected.
10. Mobile first: design at 380px, then enhance to tablet and desktop (sidebar layout >= 1024px).

IDENTITY / SECURITY
- Owner login (username + password, PBKDF2 via Web Crypto, salted) stored locally. A device ID is generated once and shown in Settings. Session has an expiry (default 24h) and requires re-login only when online.
- Passwords are never included in backups.

WORKING STYLE
- Work in small verified steps. After each step run the app mentally or with a headless check, and fix errors before continuing.
- Write docs/ARCHITECTURE.md and docs/DATA_MODEL.md and keep them updated.
- Commit after each completed feature with a clear message.
- Do not add libraries not listed above without asking.

Reply with: the CLAUDE.md you created, the planned IndexedDB schema, and a list of open questions. Do not write app code yet.