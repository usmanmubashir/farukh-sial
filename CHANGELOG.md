# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/). The app version lives in `js/core/version.js` and is shown in Settings.

## [Unreleased]

## [1.2.0] - 2026-10-29

### Added
- GitHub Pages deployment. A workflow publishes the repository root on every push to `main`. The uploaded copy has the commit SHA appended to the service worker's cache version, so each deploy gets a fresh cache. The repository itself is not changed.
- "Load demo data" in Settings. It adds 24 medicines, customers, suppliers, 30 days of sales and a few vouchers, and runs only on an empty pharmacy. The names are invented.
- README, CONTRIBUTING, LICENSE (MIT), this changelog, `.gitignore` and `.gitattributes`.
- Screenshots in `docs/screenshots/`.

### Changed
- All paths are relative, so the app works under `/repo-name/` as well as at a domain root.
- Version 1.2.0, in Settings and in the service worker.

## [1.1.0] - 2026-10-29

### Added
- Content Security Policy. Inline scripts and `eval` are blocked. The inline `onload` stylesheet hooks were removed.
- Error boundary: uncaught errors and unhandled rejections show a toast and are written to a local error log (schema 5).
- Storage-full errors have their own message.
- Double-submit guard: repeated submits and primary clicks within 800 ms are dropped.
- Undo for discarding a held sale and for removing an order line.
- Reduce-motion switch in Settings, on top of the device setting.
- Skeleton with `aria-busy` while each page renders.
- Migration test (`tests/migration.html`): upgrade from schema version 1 to the current version.
- Checks: `scripts/audit-budget.mjs` (first-load budget and preload block) and `scripts/audit-contrast.mjs`.
- `tests/e2e-checklist.md`: 40 manual scenarios, with results.

### Changed
- Errors are announced as alerts. POS totals are live regions.
- Search lists repaint 150 ms after typing stops.
- Layout-property transitions were removed from the sliding indicators.
- Field outlines meet 3:1 contrast in both themes.
- Boot runs its independent reads together, and sync starts in the background.

### Fixed
- The Content Security Policy first went in with its quotes lost, which blocked the app. Lighthouse caught it before release.

## [1.0.0] - 2026-10-29

The first feature set, built up in steps:

### Added
- Foundation: IndexedDB layer with migrations, hash router, i18n (English and Urdu, right to left), owner login (PBKDF2, 24-hour sessions) and device ID.
- Services: products, stock by batch with first-expiry-first-out allocation, double-entry ledger, sales, purchases, returns, order list, batch trace.
- Design system, motion system and a developer style guide.
- Dashboard, Medicines, Stock and Expiry screens.
- Sale screen (`#/pos`): keyboard flow, cash, card, bank and mobile payments, Rx register, receipts (browser print and Bluetooth ESC/POS).
- Purchases, sales, returns, order list, batch trace and Rx register screens.
- Customers, suppliers, cash book and accounts (bank and wallet accounts).
- Reports: 23 reports, daily rollups, virtual tables, CSV export.
- Settings: language, number digits, pharmacy profile, receipt printer, rules, sales tax, document prefixes, backup reminder.
- Backup and restore: one file with a checksum and schema check, a typed confirmation, and an atomic restore.
- Offline-first PWA with a precached shell, and an outbox with a sync engine and a Supabase adapter (see `docs/SYNC.md`).
