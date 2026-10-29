# Data model

Local database: IndexedDB `shifa-pos`, schema version **1** (see `js/core/db.js`, `migrations`).
Every write goes through `db.transaction()`, which also queues synced rows in `outbox` in the same transaction.

## Conventions

- **Money**: integer paisa in fields named `amount`, `total`, `rate`, `price`, `balance`, etc. Never floats.
- **Dates**: business dates are `YYYY-MM-DD` strings (local calendar date). Audit fields (`updatedAt`, `createdAt`) are ISO timestamps (UTC).
- **Keys**: `id` is a UUID (`crypto.randomUUID`, with a fallback). Settings, counters and sync state use a `key` string.
- **Search keys**: names are stored lowercased in `nameKey`, `genericKey`, `companyKey` so prefix search works on IndexedDB indexes.
- **Stock is never stored as a number on a batch.** Stock for a batch = sum of `stockMovements.qty` where `batchId` matches. `recalculateStock()` rebuilds any cached totals from movements (service arrives later).
- **Document numbers** come from `counters` (`ctx.nextNumber(name)`) and are formatted as `PREFIX-0001` (SALE, PUR, SRN, PRN, RCV, PAY, TRF, ADJ). The per-device prefix option is part of the number, so two devices never collide.
- **Double entry**: every business document posts ledger rows whose debits equal credits (`ledgerEntries`).
- **Synced vs local**: stores in `SYNCED_STORES` go to the outbox. `settings`, `counters`, `outbox`, `syncState` and `users` are device-local.
- **Passwords** exist only in `users` (PBKDF2-SHA256, salted). `users` is never synced and never included in backups.

## Stores

| Store | Key | Indexes | Synced | Notes |
|---|---|---|---|---|
| products | id | name(nameKey), generic(genericKey), company(companyKey), barcode, code | yes | Product master |
| batches | id | productId, productExpiry[productId, expiry] | yes | Batch number and expiry. No quantity field. |
| stockMovements | id | batchId, productId, date | yes | Append-only ledger of qty in/out. Source of truth for stock. |
| customers | id | name(nameKey), phone | yes | |
| suppliers | id | name(nameKey), phone | yes | |
| sales | id | date, customerDate[customerId, date], number (unique) | yes | Sale header |
| saleItems | id | saleId, productId | yes | Sale lines |
| purchases | id | date, supplierDate[supplierId, date], number (unique) | yes | Purchase header |
| purchaseItems | id | purchaseId, productId | yes | Purchase lines |
| returns | id | date, typeDate[type, date], number (unique) | yes | `type`: `sale` (SRN) or `purchase` (PRN) |
| returnItems | id | returnId, productId | yes | |
| accounts | id | code (unique) | yes | Chart of accounts. System rows have `system: true` and fixed ids (`acc-1000`...). |
| ledgerEntries | id | accountDate[accountId, date], date, doc[docType, docId] | yes | Double-entry lines |
| vouchers | id | date, number (unique) | yes | Receipts (RCV), payments (PAY), transfers (TRF), adjustments (ADJ) |
| demandList | id | productId, status | yes | Items to reorder |
| settings | key | — | no | `{ key, value }`. Keys: `pharmacyName`, `deviceId`, `session` |
| counters | key | — | no | `{ key, value }`. Last issued number per sequence |
| syncState | key | — | no | Sync cursor and adapter state |
| outbox | seq (auto) | status | no | `{ store, op: 'put' \| 'delete', key, record?, status, createdAt, attempts }` |
| users | id | username (unique) | no | Owner account: `{ id: 'owner', username, salt, hash, iterations }` |

Every synced row also carries `updatedAt` (ISO timestamp), added automatically by `ctx.put`.

## Seeded data (first boot, idempotent)

System accounts from `js/services/ledger.js` (`DEFAULT_ACCOUNTS`). Names are translated through `account.*` keys.

| Code | Id | Account | Type | Normal |
|---|---|---|---|---|
| 1000 | acc-1000 | Cash in Hand | asset | debit |
| 1100 | acc-1100 | Customer Receivables | asset | debit |
| 2000 | acc-2000 | Supplier Payables | liability | credit |
| 2100 | acc-2100 | Sales Tax Payable | liability | credit |
| 3000 | acc-3000 | Opening Balance Equity | equity | credit |
| 4000 | acc-4000 | Sales | income | credit |
| 4100 | acc-4100 | Sales Returns | income | debit (contra) |
| 4200 | acc-4200 | Other Income | income | credit |
| 5000 | acc-5000 | Purchases | expense | debit |
| 5100 | acc-5100 | Purchase Returns | expense | credit (contra) |
| 6000 | acc-6000 | General Expenses | expense | debit |

System accounts are undeletable. The service layer enforces that when delete is added.

## Outbox row

```
{ seq: 12, store: "products", op: "put", key: "<uuid>", record: { ...row },
  status: "pending", createdAt: "2026-10-29T10:00:00.000Z", attempts: 0 }
```

`sync.flush()` sends pending rows through the adapter and removes the ones it acknowledges.

## Browser-local UI preferences (localStorage, not business data)

- `shifa.lang`: `en` or `ur`
- `shifa.theme`: `auto`, `light` or `dark`

## Planned, not yet in the schema

Batch expiry alerts, stock adjustments, customer credit limits, and backup/restore metadata will be added as new migrations (`migrations[1]` and later). Existing migrations are not edited.
