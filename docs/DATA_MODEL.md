# Data model

Local database: IndexedDB `shifa-pos`, schema version **1** (see `js/core/db.js`, `migrations`).
Every write goes through `db.transaction()`, which also queues synced rows in `outbox` in the same transaction.

## Conventions

- **Money**: integer paisa in fields named `amount`, `total`, `rate`, `price`, `balance`, etc. Never floats.
- **Dates**: business dates are `YYYY-MM-DD` strings (local calendar date). Audit fields (`updatedAt`, `createdAt`) are ISO timestamps (UTC).
- **Keys**: `id` is a UUID (`crypto.randomUUID`, with a fallback). Settings, counters and sync state use a `key` string.
- **Search keys**: names are stored lowercased in `nameKey`, `genericKey`, `companyKey` so prefix search works on IndexedDB indexes.
- **Stock truth is `stockMovements`.** Each movement has a signed `units` value (base units: tablets, ml). Stock of a batch = sum of its movements. Stock of a product = sum over its batches.
- **`batches.onHand` is a cache** of the movement sum. Only `applyMovementIn()` writes it. `recalculateStock()` rebuilds it, and `checkIntegrity()` reports any batch where the cache and the movements disagree.
- **Document numbers** come from `counters` (`ctx.nextNumber('doc:<kind>')`) and are formatted as `PREFIX-0001`, or `PREFIX-<devicePrefix>-0001` when the device prefix is set (SALE, PUR, SRN, PRN, RCV, PAY, TRF, ADJ). A failed transaction does not consume a number.
- **Double entry**: every business document posts ledger rows whose debits equal credits (`ledgerEntries`).
- **Synced vs local**: stores in `SYNCED_STORES` go to the outbox. `settings`, `counters`, `outbox`, `syncState` and `users` are device-local.
- **Passwords** exist only in `users` (PBKDF2-SHA256, salted). `users` is never synced and never included in backups.

## Stores

| Store | Key | Indexes | Synced | Notes |
|---|---|---|---|---|
| products | id | name(nameKey), generic(genericKey), company(companyKey), barcode, code | yes | Product master (fields below) |
| batches | id | productId, productExpiry[productId, expiry] | yes | `batchNo`, `expiry` (ISO, last day of month for MM/YY), `costPerPack`, `mrp`, `receivedAt`, `onHand` (cache) |
| stockMovements | id | batchId, productId, date | yes | `units` (signed), `type`, `docType`, `docId`, `date`, `note`. Source of truth. |
| customers | id | name(nameKey), phone | yes | `name`, `phone`, `address` |
| suppliers | id | name(nameKey), phone | yes | `name`, `phone`, `address` |
| sales | id | date, customerDate[customerId, date], number (unique) | yes | Sale header: subtotal, discount, tax, total, paid, balance, cost, profit, patient, doctor, payments[], status, returnedTotal |
| saleItems | id | saleId, productId | yes | `packs`, `looseUnits`, `units`, `amount`, `cost`, `allocations[]` (batch, units, costPerPack, returnedUnits), `returnedUnits`, `returnedAmount` |
| purchases | id | date, supplierDate[supplierId, date], number (unique) | yes | Purchase header: total, paid, balance, returnedValue |
| purchaseItems | id | purchaseId, productId | yes | `batchId`, `batchNo`, `expiry`, `packs`, `units`, `costPerPack`, `mrp`, `amount`, `returnedPacks` |
| returns | id | date, typeDate[type, date], number (unique) | yes | `type`: `sale` (SRN) or `purchase` (PRN). gross, tax, net, refund, credit, cost, entryId |
| returnItems | id | returnId, productId | yes | Return lines. Sale returns list the batches restored. |
| accounts | id | code (unique) | yes | Chart of accounts. System rows have `system: true` and fixed ids (`acc-1000`...). |
| ledgerEntries | id | accountDate[accountId, date], date, doc[docType, docId] | yes | One row per line: `entryId`, `accountCode`, `partyId`, `debit`, `credit`, `docType`, `docId`, `memo` |
| vouchers | id | date, number (unique) | yes | `type`: receipt (RCV), payment (PAY), transfer (TRF), adjustment (ADJ) |
| demandList | id | productId, status | yes | `name`, `nameKey`, `packs`, `reason` (low_stock, not_found, manual), `status` (open, ordered), `note` |
| settings | key | — | no | `{ key, value }`. Keys: `pharmacyName`, `deviceId`, `session`, `business` (business rules), `heldCarts` (parked carts) |
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
| 1200 | acc-1200 | Inventory | asset | debit |
| 2000 | acc-2000 | Supplier Payables | liability | credit |
| 2100 | acc-2100 | Sales Tax Payable | liability | credit |
| 3000 | acc-3000 | Opening Balance Equity | equity | credit |
| 4000 | acc-4000 | Sales | income | credit |
| 4100 | acc-4100 | Sales Returns | income | debit (contra) |
| 4200 | acc-4200 | Other Income | income | credit |
| 5000 | acc-5000 | Purchases | expense | debit |
| 5100 | acc-5100 | Purchase Returns | expense | credit (contra) |
| 5200 | acc-5200 | Cost of Goods Sold | expense | debit |
| 6000 | acc-6000 | General Expenses | expense | debit |

System accounts are undeletable. The service layer enforces that when delete is added.

Inventory is perpetual. Purchases debit Inventory, and sales move cost from Inventory to COGS. Purchases (5000) and Purchase Returns (5100) are seeded for reports and are not used by posting yet.

## Medicine fields (products)

Added for the Medicines screen, on top of the pack model below.

| Field | Meaning |
|---|---|
| `nameUr` | Urdu name, shown in grey under the English name |
| `strength`, `form` | e.g. `500mg`, `tablet` (form list in `FORMS`, products.js) |
| `mrpPerPack` | printed MRP per pack, paisa. Purchases with a new MRP update it. |
| `salePricePerPack` | price charged per pack. Defaults to the MRP. |
| `wholesalePerPack` | optional wholesale price per pack |
| `rack`, `group` | shelf location, and a group name from the device's group list (`settings.productGroups`) |
| `directions` | usual directions, free text |
| `trackStock` | `false` for services or items not counted: they sell without touching batches |
| `photo` | small data URL, at most 150 KB |

Settings keys added: `productGroups` (group names), `lastBackupAt` (set by the backup screen when it exists; the home screen's "No backup yet" nudge reads it).

Popular medicines (`js/services/seed-medicines.js`) import without prices. Import skips a medicine already present with the same name and strength.

## Pack model (products)

| Field | Meaning |
|---|---|
| `soldAs` | pack, strip, box, bottle, vial, tube, sachet, piece or ampoule |
| `unitsPerPack` | base units per pack (10 tablets per strip). Stock is kept in units. |
| `unitName` | label for a unit, e.g. "tablet" |
| `looseSelling` / `looseUnitPrice` | sell single units at `looseUnitPrice` paisa each (needs `unitsPerPack` ≥ 2) |
| `packsPerBox` | optional |
| `costPerPack` / `salePricePerPack` | paisa per pack. Updated from the latest purchase when the setting is on. |
| `reorderLevel` / `reorderQty` | in packs. Below `reorderLevel` the product goes on the demand list. |
| `class` | otc, rx, controlled, general. Rx and controlled need patient and doctor on sales (setting). |
| `storage` | room, cool, fridge |
| `active` | inactive products cannot be bought or sold |

`generic` is the salt. `alternatives()` returns active products with the same `genericKey`.

## Stock formulas

- Batch stock: `sum(stockMovements.units where batchId)`. Cache: `batches.onHand`.
- Sellable for FEFO: `onHand > 0` and `expiry >= today`. Expired stock is never sold.
- Movement types: `purchase`, `opening`, `sale`, `sale_void`, `sale_return`, `purchase_return`, `adjust`, `consume`.
- A sale's allocations are stored on the sale line, so a void or return restores the same batches.

## Ledger rules

- `postEntry` rejects unbalanced lines before writing anything. Zero lines are dropped.
- Sale: Dr Cash (paid), Dr Receivable (balance, party = customer), Cr Sales (total − tax), Cr Sales Tax Payable (tax), Dr COGS (cost), Cr Inventory (cost).
- Purchase: Dr Inventory (total), Cr Cash (paid), Cr Payable (balance, party = supplier).
- Sale return: Dr Sales Returns (net), Dr Sales Tax Payable (tax), Cr Cash (refund), Cr Receivable (credit), Dr Inventory (cost), Cr COGS (cost).
- Purchase return: Dr Cash (refund), Dr Payable (value − refund), Cr Inventory (value).
- Void: the exact reverse of the sale's posted lines.
- Balance: `debit − credit`. A negative balance on a payable means money is owed to the party.

## Planned, not yet in the schema

Batch expiry alerts, customer credit limits, and backup/restore metadata will be added as new migrations (`migrations[1]` and later). Existing migrations are not edited.

## Outbox row

```
{ seq: 12, store: "products", op: "put", key: "<uuid>", record: { ...row },
  status: "pending", createdAt: "2026-10-29T10:00:00.000Z", attempts: 0 }
```

`sync.flush()` sends pending rows through the adapter and removes the ones it acknowledges.

## Browser-local UI preferences (localStorage, not business data)

- `shifa.lang`: `en` or `ur`
- `shifa.theme`: `auto`, `light` or `dark`

