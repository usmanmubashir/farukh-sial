# Architecture

Shifa Pharmacy POS is a single-page app written in plain HTML, CSS, ES2020 modules and jQuery 3.7. There is no bundler and no build step. `index.html` is the only HTML page. Everything runs when you open it from any static server, and it can be deployed to GitHub Pages unchanged.

## Layers

```
pages (js/pages)  ->  services (js/services)  ->  db (js/core/db.js)  ->  IndexedDB
        \                    |
         \-- core UI modules (router, i18n, store, ui, auth, sync)
```

- **Pages** render UI and handle input. They never touch IndexedDB directly.
- **Services** hold business rules (ledger posting, numbering, stock). They are the only code that calls `db.transaction()` for business writes.
- **Core** holds infrastructure: the database, router, state, i18n, money and dates helpers, auth, sync and UI helpers.

### Service layer (`js/services`)

| Module | Responsibility |
|---|---|
| `errors.js` | `ServiceError` with a stable `code`, plus validators (`requireInt`, `optionalInt`, `requireText`, `requireOneOf`) |
| `settings.js` | Business rules with defaults (`business` row). Read in-transaction with `readSettingsIn(ctx)` |
| `numbering.js` | `nextDocNumber(ctx, kind)`: SALE-0001, optional device prefix |
| `parties.js` | Customers and suppliers. Balances come from the ledger, not from the row |
| `products.js` | Product master: pack model, validation, unique code and barcode, search, alternatives |
| `stock.js` | Batches, FEFO allocation, movements, adjustments, lowStock, outOfStock, expiringSoon, recalculateStock, checkIntegrity |
| `ledger.js` | Chart of accounts, `postEntryIn` (balanced or throws), line builders per document type, vouchers, balances, trial balance |
| `sales.js` | createSale, voidSale, hold and resume carts |
| `purchases.js` | createPurchase with cost and MRP maintenance |
| `returns.js` | Sale returns (restores the original batches) and purchase returns (including expired stock) |
| `demand.js` | Order list: auto low-stock, search misses, manual adds, WhatsApp text and link |
| `dashboard.js` | Home screen numbers in one read: today's hero, attention counts, overview, seven-day chart, top medicines |
| `pos.js` | Sale screen data: `saleCards` (stock status, nearest sellable batch, rack, match score), `alternativesInStock`, `cardForBarcode`. Reads only; writes go through `sales.js` |
| `receipt.js` | Receipt model (`buildReceipt`), WhatsApp text (`receiptText`) and print HTML (`receiptHtml`). English labels for now |
| `printing.js` | Browser print (58/80 mm via `print.css`) and Web Bluetooth ESC/POS. Urdu is drawn on a canvas with Noto Nastaliq and sent as a raster image (`GS v 0`). Not yet tested on hardware |
| `seed-medicines.js` | Popular medicines to import (about 190 entries, no prices). Review brands and packs before relying on them |

Stock views: `stock.batchRows()` gives each batch's stock, value at cost and retail, days to expiry, expiry bucket and the purchase line it came from. `returns.returnExpiredBatches()` uses it to send expired stock back to suppliers.

Screens for medicines live in `js/pages`: `products.js` (Medicines), `stock.js`, `expiry.js`, `dashboard.js`. Their shared pieces are `_medicine-shared.js` (filters, search, stock line), `_medicine-form.js` (the new/edit form, a bottom sheet on phones) and `_medicine-dialogs.js` (groups, barcode entry). The medicine form's copy lives in `js/i18n/screens-en.js` and `screens-ur.js`, which `i18n.js` merges over the base dictionaries.

**Transactions.** Each public function runs one `db.transaction()`. Functions named `...In(ctx, ...)` take the caller's context, so a sale can allocate stock, write the document, and post the ledger in the same transaction. Any throw rolls everything back: stock, numbers, ledger and outbox. `ctx.nextNumber` runs inside that transaction too, so a failed sale leaves no gap in the numbering.

**Errors.** Services throw `ServiceError` with a `code` (for example `insufficientStock`, `walkInCredit`, `unbalanced`). The UI maps codes to `auth.err.*`-style translations, and the tests assert on codes.

**Sale screen (`js/pages/pos.js`).** Typing filters the card list. Enter adds the top card (Shift+Enter as loose units, `3*name` for a quantity). Enter presses and F4 go through one queue (`searchQueue`), so a line typed just before F4 is in the cart before the pay sheet opens. The search box is cleared at the moment Enter is pressed, so keys typed during the add start from an empty box. Each search has its own sequence number, so an older result cannot overwrite a newer one. Rx and controlled lines ask for patient and doctor on the pay sheet. Product cards are not in the Tab order (`tabindex="-1"`); ArrowDown from the search box moves into the grid. Dialogs opened by the page close when the user leaves it.

**Tests.** `tests/services.test.html` runs against its own database (`shifa-services-test`), so it never touches the app's data. It has 220 assertions across products, stock/FEFO, ledger, sales, purchases, returns, demand, medicines/dashboard and the sale screen (cards, FEFO override, expired batch refusal, bank split, change, discounts, price edit setting, Rx register).

## Page contract

Every page module in `js/pages/` exports:

```js
export const route = '/sales';        // the path it serves (must match js/app.js)
export const title = 'nav.sales';     // i18n key for the header and document title
export function render($root, params, query) {}  // $root is a jQuery element; may be async
export function destroy() {}          // release timers and subscriptions
```

The router calls `destroy()` on the previous page before it renders the next one, and it empties `#view`, which removes jQuery handlers. Bind handlers to elements inside the page (`$root.find('#x').on(...)`), never to `$root` itself, since `$root` is the shared `#view` element.

## Routing

- Hash routes: `#/sales`, `#/products/:id?tab=batches`.
- `js/app.js` holds the route table. Each entry has `guard` (`setup`, `guest`, `auth`, `public`), `chrome` (shell on or off), `nav` and `bottom`.
- `createRouter()` in `js/core/router.js` parses the hash, runs `beforeEach` guards (they may return `false`, or a path to redirect to), loads the page with a dynamic import, animates the transition, and emits `route:loading` and `route:after`.
- Navigation is stale-safe: each navigation takes a token, and a page that finishes loading after a newer navigation is dropped.
- An unknown path renders `pages/notfound.js`.

## Data flow and reactivity

- `db.transaction(work)` is the single write path. It runs one readwrite transaction over every store, and synced rows are queued in `outbox` inside that same transaction, so a write and its sync entry commit together or not at all. When it commits, it emits `data:changed` with the store names it touched.
- Pages that show data subscribe to `data:changed` (filtered by store) and re-read through services. Pages unsubscribe in `destroy()`.
- `js/core/store.js` holds UI state only (language, online flag, session summary, pharmacy name, sync backlog). `subscribe(key, fn)` notifies on change.
- `js/core/events.js` is the pub/sub bus used by all of the above.

## Money, dates, i18n

- `money.js` stores integer paisa. `parseRupees()` turns typed text into paisa (accepts Urdu digits). `format()` is used only at display time. Rounding is half away from zero, and `roundToRupee()` handles pharmacies that round totals.
- `dates.js` stores `YYYY-MM-DD` strings and displays `DD/MM/YYYY`.
- `i18n.js` translates with `t('key', vars)`. Language switching does not reload the page: the store fires, the nav is rebuilt, `data-i18n` markup is re-applied, and the current route re-renders. `[dir=rtl]` is set on `<html>` for Urdu, and all layout CSS uses logical properties (`inset-inline-start`, `padding-inline`, `border-inline-end`). Urdu uses Noto Nastaliq Urdu.

## Auth and sessions (`js/core/auth.js`)

- First run: no `users` row means the app shows `/setup`, which creates the owner (username plus password, PBKDF2-SHA256 with 310,000 iterations and a 16-byte salt) and the pharmacy name, then signs in.
- Login compares derived hashes in constant time. After 5 failed attempts the form locks for 30 seconds. The throttle is in memory.
- Sessions are stored in `settings` with a 24-hour expiry. The guard checks `isAuthenticated()`. An expired session still counts as signed in while offline, and forces a new login once the device is back online.
- Device ID: generated once at boot and shown in Settings.

## Sync (`js/core/sync.js`)

- `outbox` holds every pending synced write. `flush()` hands up to 200 rows to the active adapter and removes the rows it acknowledges.
- Adapter contract: `{ name, push(rows) → Promise<number[]> }` returns the acknowledged outbox `seq` values.
- The default adapter is offline, so nothing is sent. The Supabase REST adapter is planned, and it plugs in through `useAdapter()`.
- `flush()` runs on reconnection and about 1.5 seconds after a synced write.

## Accessibility and motion

- Keyboard: skip link, visible `:focus-visible` outline, focus moved into dialogs and back on close, Escape closes drawers and dialogs, Tab is trapped inside dialogs.
- ARIA: labels on icon buttons, `aria-current` on the active nav link, `role="status"` on the connectivity pill, `role="alert"` on form errors and fatal errors.
- Motion: `prefers-reduced-motion` disables CSS animations and skips the Web Animations API transitions in `anim.js`.

## Styling

- `css/tokens.css` defines the design tokens (colour, spacing, type, radius, shadows, sizes). Dark values are in `css/dark.css` and follow the device unless `data-theme` is set.
- Layout is mobile first at 380px. At 1024px and up, the sidebar becomes a sticky column and the bottom bar is hidden. Print styles are in `css/print.css`.

## Browser support

Modern Chrome, Edge, Firefox and Safari. Requires IndexedDB, Web Crypto (PBKDF2), ES modules, `crypto.randomUUID` (with a fallback), and the Web Animations API (optional).

## Status

Done: app shell, IndexedDB with migrations, router with guards and transitions, store and events, money and dates, i18n (English and Urdu, RTL), auth (setup, login, sessions, device ID), seeded chart of accounts, sync skeleton with outbox, self-tests in `tests/test.html`.

Services: products, stock and FEFO, ledger posting, sales, purchases, returns, parties, demand list, settings and numbering, dashboard and sale-screen data, all tested in `tests/services.test.html`.

Screens: dashboard, Medicines, Stock, Expiry, and the sale screen (`#/pos`). Verified in the browser: a keyboard-only sale of three lines (loose and pack, two of them Rx) completes, and stock, ledger, Rx register rows and the dashboard update from it. Print (browser) and the WhatsApp link were checked on the success screen.

Not yet: the Rx register screen (a stub; its data is written), the Rx register and cash book screens, the sales list, purchases, customers and suppliers screens, reports, backup, Bluetooth printing on hardware, camera scanning on a device, and the Supabase adapter.

Service worker and manifest: `sw.js` and `manifest.webmanifest` are in place with a precache list, but registration failed in the test browser ("unknown error when fetching the script"), so offline start has not been verified yet.
