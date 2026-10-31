# Data model

Local database: IndexedDB `shifa-pos`, schema version **3** (see `js/core/db.js`, `migrations`).

| Version | Change |
|---|---|
| 1 | Base schema: products, batches, stock movements, parties, sales, purchases, returns, ledger, vouchers, demand list, settings, counters, outbox, users |
| 2 | Adds `rxRegister` (one row per Rx or controlled line sold, for the Rx register) |
| 3 | Adds the daily rollups for reports: `dailySales`, `dailyProducts`, `dailyLedger` (local, derived; see the rollups note below the store list) |
| 4 | Sync: adds the `tombstones` store, and a `stamp` on every synced row (existing rows get legacy stamps on upgrade). Backups from version 3 still restore. |
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
- **Synced vs local**: stores in `SYNCED_STORES` go to the outbox. `settings`, `counters`, `outbox`, `syncState` and `users` are device-local. `tombstones` is device-local too, but it is part of the sync state and goes into backups.
- **Passwords** exist only in `users` (PBKDF2-SHA256, salted). `users` is never synced and never included in backups.

## Stores

| Store | Key | Indexes | Synced | Notes |
|---|---|---|---|---|
| products | id | name(nameKey), generic(genericKey), company(companyKey), barcode, code | yes | Product master (fields below) |
| batches | id | productId, productExpiry[productId, expiry] | yes | `batchNo`, `expiry` (ISO, last day of month for MM/YY), `costPerPack`, `mrp`, `receivedAt`, `onHand` (cache) |
| stockMovements | id | batchId, productId, date | yes | `units` (signed), `type`, `docType`, `docId`, `date`, `note`. Source of truth. |
| customers | id | name(nameKey), phone | yes | `name`, `phone`, `email`, `address`, `note`, `active` (false = inactive; missing counts as active). Balance is in the ledger (account 1100) |
| suppliers | id | name(nameKey), phone | yes | `name`, `phone`, `email`, `address`, `note`, `active`. Balance is in the ledger (account 2000) |
| sales | id | date, customerDate[customerId, date], number (unique) | yes | Sale header: subtotal, discount, tax, total, paid, paidCash, paidBank, tendered, change, balance, cost, profit, patient, doctor, payments[] (method cash, card, bank or mobile, and accountCode for anything but cash: the bank or wallet account it went to), status, returnedTotal |
| saleItems | id | saleId, productId | yes | `packs`, `looseUnits`, `units`, `amount`, `cost`, `unitPricePack`, `unitPriceLoose`, `lineDiscount`, `strength`, `class`, `allocations[]` (batch, units, costPerPack, returnedUnits), `returnedUnits`, `returnedAmount` |
| rxRegister | id | saleId, date, productId | yes (v2) | One row per Rx or controlled line: `saleNumber`, `date`, `customerId`, `productId`, `productName`, `strength`, `class`, `units`, `batches[]`, `patient`, `doctor`. Removed when its sale is voided |
| purchases | id | date, supplierDate[supplierId, date], number (unique) | yes | Purchase header: total, paid, balance, returnedValue, payFrom (the money account the paid part left from; cash by default) |
| purchaseItems | id | purchaseId, productId | yes | `batchId`, `batchNo`, `expiry`, `packs`, `units`, `costPerPack`, `mrp`, `amount`, `returnedPacks` |
| returns | id | date, typeDate[type, date], number (unique) | yes | `type`: `sale` (SRN) or `purchase` (PRN). gross, tax, net, refund, credit, cost, entryId |
| returnItems | id | returnId, productId | yes | Return lines. Sale returns list the batches restored. |
| accounts | id | code (unique) | yes | Chart of accounts. System rows have `system: true` and fixed ids (`acc-1000`...). `kind`: cash (1000), bank (1010, and any added bank), wallet (added wallets), or null for the rest. Added bank and wallet accounts take codes 1011–1099 and have `note`. Money accounts can receive sales, receipts and transfers, and pay purchases, supplier payments and expenses. |
| ledgerEntries | id | accountDate[accountId, date], date, doc[docType, docId] | yes | One row per line: `entryId`, `accountCode`, `partyId`, `debit`, `credit`, `docType`, `docId`, `memo` |
| vouchers | id | date, number (unique) | yes | `type`: receipt (RCV), payment (PAY), expense (EXP), income (INC), transfer (TRF), adjustment (ADJ). Each has `amount`, `entryId`, `note`, and the accounts it used (`accountCode` and `fromCode`/`toCode`, or `partyId` for receipts and payments) |
| demandList | id | productId, status | yes | `name`, `nameKey`, `packs`, `reason` (low_stock, not_found, manual), `status` (open, ordered), `note`, `supplierId` (preferred supplier, optional; set from the order list) |
| settings | key | — | no | `{ key, value }`. Keys: `business` (business rules: the sale, purchase, printing, tax, session, backup reminder and document settings), `profile` (pharmacy profile: name, Urdu name, address, phone, NTN, licence, qualified person, receipt footer, currency), `pharmacyName` (kept equal to the profile name), `closing.<date>` (counted cash on the daily closing, in paisa), `rollups` (version of the report rollups). Device-only keys, never in a backup: `deviceId`, `session`, `lastBackupAt` |
| counters | key | — | no | `{ key, value }`. Last issued number per sequence |
| syncState | key | — | no | Sync cursor (`cursor`). Device-only: not in backups |
| tombstones | id (`store:key`) | — | no | One row per deleted synced row: `{ store, key, stamp }`. Blocks older copies from coming back. In backups |
| dailySales | date | — | no | Rollup, one row per day: `invoices`, `subtotal`, `discount`, `tax`, `total`, `cost`, `profit`, `cash`, `bank`, `credit`. Live sales only |
| dailyProducts | key (`date\|productId`) | date | no | Rollup, one row per day and medicine: `units`, `lines`, `amount`, `net` (net of tax, allocated per line), `cost`, `profit` |
| dailyLedger | key (`accountCode\|date\|group`) | accountCode | no | Rollup of the cash account (1000) per day and kind of movement: `debit`, `credit` |
| outbox | seq (auto) | status | no | `{ store, op: 'put' \| 'delete', key, record?, status, createdAt, attempts }` |
| users | id | username (unique) | no | Accounts: the owner (`{ id: 'owner', username, salt, hash, iterations }`) and staff (`{ id, username, salt, hash, iterations, sections[], active, createdAt, updatedAt }`). `sections` lists the sections the staff account may open (see ARCHITECTURE.md, Users and section access). No schema change was needed: the store already existed. |

Every synced row also carries `updatedAt` (ISO timestamp), added automatically by `ctx.put`.

**Backup file.** One JSON document (gzip-compressed when the browser supports it): `format` (`shifa-pos-backup`), `schemaVersion` (the database version, which must match on restore), `app`, `createdAt`, `deviceId` (where it was made), `counts` (records per store), `checksum` (SHA-256 of the `stores` part as written), and `stores` (every store except `users` and `outbox`, with the device-only settings left out). No password is ever in a backup. Restore checks the format, the schema version and the checksum before it changes anything, then replaces the stores in one transaction.

**Rollups.** The three rollup stores are derived data. Every sale, void and cash posting updates them in the same transaction as the business write (`services/rollups.js`), so they cannot drift from the sales. `rebuildRollups()` recomputes them from the source rows in one transaction. The first report run builds them when the `settings` row `rollups` is missing (once per database). They are device-local and never synced.

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

## Practice (approved; services implemented)

Status: approved with the ten recommendations. The services step is implemented: schema version 6, the two accounts, the ledger lines, the stock movements, the practice rollup, `js/services/practice.js` (create, void, read, kits) and tests in `tests/services.test.html` (group "practice"). Built since: the Practice screen (`#/practice`, with holds, kits, repeat last, undo after save, and the slip), the history page (`#/practice-list`, with owner void), the dashboard tile and the Ctrl+K entries, the dashboard Sales vs Practice donut, and the practice reports (`#/reports/practice`, `practice-medicine`, `top-products` with `slow-movers`, and `sales-vs-practice`), which read through `js/services/practice-reports.js`. Still to build: the practice columns on the existing reports (section E), the Settings controls for the practice rules, the camera scan on the Practice screen, and a native-speaker review of the Urdu.

### Implementation notes (what the code does)

- `practiceItems` has one row per batch allocation. `unitType` is the unit the cashier chose for the line (`pack`, or `loose` when the line has loose units). `qtyUnits` is always in base units.
- `listPrice` and `costPerUnit` are rounded per unit. `lineList` and `lineCost` are exact: the list price of a line is split across its batches, and the last batch takes the rounding.
- A void posts its reverse on the day it is made (`voidDate`). The practice rollup, however, is reduced on the practice's own date, so the day it was earned stays correct.
- Rx and controlled items write an `rxRegister` row with `source: "practice"`, `practiceId` and `saleId: null`.
- Settings added: `allowBackdating` (false), `practiceWarnBelowCost` (true), `practicePrintListPrice` (false), `practiceShowCost` (true), `practiceDefaultAccount` ('1000'). Document prefix `practice`: 'PRC'.
- Errors: `backdatingNotAllowed`, `practiceCustomerRequired`, `practiceAlreadyVoided`, `emptyPractice`, and the existing `insufficientStock`, `patientDoctorRequired`, `required` (empty void reason).
- Sync: the four practice stores are synced. `practices.number` and `practiceVoids.practiceId` are unique, and a clash is reported as a sync issue.

A **practice** is medicine given to a patient at the owner's discretion, with a charge the owner decides. It is not a sale. It is kept in its own stores, its own income account and its own cost account, so sales profit and practice profit can be reported apart.

### Stores (schema version 6)

| Store | Key | Indexes | Synced | Purpose |
|---|---|---|---|---|
| `practices` | `id` | `number` (unique), `date`, `customerId` | yes | One immutable document per practice. Amounts in paisa. |
| `practiceItems` | `id` | `practiceId`, `productId`, `batchId` | yes | One row per batch allocation. Keeps the exact batch and cost, so a void restores the same stock. |
| `practiceVoids` | `id` | `practiceId` (unique) | yes | Append-only void event. One per practice at most. |
| `practiceKits` | `id` | `name` | yes | Saved item sets ("Fever kit"). Edited with last writer wins. |
| `dailyPractice` | `date` | — | no (derived) | Daily rollup for reports, rebuilt like the sales rollups. |

Fields of `practices`:

```
{ id, number: "PRC-0001", date: "2026-10-28", dateTime: "2026-10-28T14:35:00.000Z",
  patientName, patientPhone, doctorRef, note,
  customerId: null,            // set when the practice is on a customer's account (udhaar)
  calculatedTotal,             // paisa: sum of qty × sale price (loose price where used)
  chargedAmount,               // paisa: what the owner decided to charge (any amount ≥ 0)
  costTotal,                   // paisa: sum of FEFO batch costs of the allocations
  profit,                      // paisa: chargedAmount − costTotal (stored for reports, recomputed on read)
  paymentAccountCode,          // '1000' cash, '1010' bank, '1011–1099' wallets, or '1100' receivable (udhaar)
  createdBy, deviceId, prefix: "PRC", isRx: false, updatedAt, stamp }
```

Fields of `practiceItems`: `{ id, practiceId, productId, batchId, unitType: "pack" | "loose", qtyUnits, listPrice, costPerUnit, lineList, lineCost, date }`. Money in paisa. `qtyUnits` is in base units, like `stockMovements.units`.

Fields of `practiceVoids`: `{ id, practiceId, voidedAt, reason, voidedBy, deviceId, stamp }`. The void reason is required and the owner makes the void.

`practice.status` is not stored. It is derived: a practice is voided when a `practiceVoids` row exists for it. This keeps the practice record immutable, which is the sync rule (see below).

Migration (version 5 to 6): creates `practices`, `practiceItems`, `practiceVoids`, `practiceKits` and `dailyPractice` with the indexes above. It changes no existing store. The two new system accounts are added through `DEFAULT_ACCOUNTS` and written by `seedDefaultAccounts()` on boot, which already runs on every start and only adds missing rows. A backup from schema 3, 4 or 5 still restores; it simply has no practice rows.

### System accounts (new)

| Code | Name | Type | Normal | Group |
|---|---|---|---|---|
| 4300 | Practice Income | income | credit | Income |
| 5300 | Cost of Practice | expense | debit | Cost of goods (next to COGS 5200) |

They use the fixed ids `acc-4300` and `acc-5300`, like the other system accounts.

### Ledger entries (proposed)

Same convention as sales: money in against income, and cost moves Inventory → cost of goods. Using the example from the brief (3 Panadol and 3 Risek, calculated Rs 480, charged Rs 200, FEFO cost assumed Rs 260):

| Case | Lines | Result |
|---|---|---|
| Paid in cash | Dr 1000 Cash 200.00 · Cr 4300 Practice Income 200.00 · Dr 5300 Cost of Practice 260.00 · Cr 1200 Inventory 260.00 | Profit −60.00 (a loss) |
| Paid by bank or wallet | as above, with Dr 1010 or 1011–1099 instead of 1000 | same profit |
| On a customer's account (udhaar) | Dr 1100 Receivable 200.00 (party = customer) instead of cash | same profit; the customer's balance rises by 200 |
| Charged 0 (free) | Dr 5300 Cost of Practice 260.00 · Cr 1200 Inventory 260.00 | Profit −260.00. The zero income line is dropped, as `postEntry` already does. |
| Charged above the calculated total | as the cash case with the higher amount | allowed; the difference is still income |
| Void (owner, with reason) | exact reverse of every line of the practice, with docType `practiceVoid` | net zero; the reversal is a new append-only ledger row, not an edit |

Ledger rows carry `docType: "practice"` (or `"practiceVoid"`) and `docId` = the practice id, so `ledgerGroup()` can map them to a `practice` cash group for the cash book and the daily closing.

Balance check: the trial balance difference is zero after save, void and a zero-charge practice (each document balances on its own).

### Stock movements (proposed)

- Save: one negative movement per `practiceItems` row, `type: "practice"`, `docType: "practice"`, `docId` = practice id, `batchId` from the allocation. Allocation is FEFO through the existing `allocateFEFOIn`, so expired batches are never used.
- Void: one positive movement per row with `type: "practiceVoid"` to the same batch. The batch receives back exactly what was taken, and the history keeps both rows.
- `batches.onHand` is updated only through `applyMovementIn`, as today.

### Profit and cost

- `costTotal` is the sum of the FEFO batch costs of the allocations (`costPerUnit` × `qtyUnits`), not the latest purchase cost.
- Profit = `chargedAmount − costTotal`. It equals 4300 − 5300 for the practice's own lines, so the ledger and the practice report agree.

### Sync rules (proposed)

- `practices` and `practiceItems` are immutable after save. They are written once, with a new stamp. A device never edits them, so two devices never conflict on a practice.
- Voids are `practiceVoids` rows, append-only. A practice is voided when any void row exists. Two devices voiding the same practice both write a row with the same `practiceId`; the unique index on `practiceId` lets one win (the first stamp, by the usual last-writer order). The second device's void is reported as a sync issue, not silently applied twice.
- `practiceKits` are normal synced records with last writer wins.
- `dailyPractice` is derived and never synced.

### Reports and dashboard (proposed)

- Sales figures: from `sales` and `saleItems`, as now. Practice figures: from `practices`, `practiceItems` and the `dailyPractice` rollup.
- "Total (Sales + Practice)" is the sum of the two. Practice profit is `chargedAmount − costTotal` over non-voided practices.
- Profit summary: Sales profit, Practice profit, Expenses, Net.

### Decisions for your review

1. **Cost account.** I propose a new 5300 "Cost of Practice" next to COGS 5200, so practice cost is visible apart from sales cost. The alternative is to use 5200 for both, which is simpler but hides the practice cost in the sales profit. Recommendation: 5300.
2. **Inventory side.** Cost leaves Inventory 1200 directly, as sales do. There is no separate "purchases adjustment" account. Recommendation: keep it as sales does.
3. **Practice status.** The brief lists `status` and `voidedAt` on the practice. I propose deriving status from `practiceVoids` instead, so the practice record never changes after save. Recommendation: derive it.
4. **One item row per batch.** When a medicine is spread over two batches (FEFO), I store two `practiceItems` rows, not one. A row must map to one batch so a void restores the exact batches. Recommendation: one row per allocation.
5. **Udhaar practices need a customer.** A practice on a customer's account must name a customer (`customerId`), so the receivable is tied to a party. Recommendation: required for udhaar; optional otherwise.
6. **Tax.** Practices carry no sales tax, since the owner sets the charge. Recommendation: no tax on practices.
7. **Void window.** Voids are owner-only with a reason. I propose no time limit, but the undo toast allows a 10-second void. Question: should a later void be allowed after the batch has expired? Recommendation: yes; the stock goes back to the same batch even if it has expired, and that is recorded.
8. **Cost visibility.** The app has only the owner role today. I propose a setting "show cost on the practice screen" (default on for the owner). Staff roles do not exist yet, so the setting has no effect until they do. Question: do you want staff accounts added now?
9. **Backdating.** A setting "allow backdating" (default off). A backdated practice is posted to its own date, so the daily rollups and the closing for that day change. Recommendation: allow it for the owner only.
10. **Rx register.** A practice that contains a controlled medicine gets an `rxRegister` row with `source: "practice"`, so the Rx register shows it tagged "Practice".

## Sync fields (schema version 4)

Every row in a synced store carries `stamp`, the time and device of its last change: `"001793271840718.000000.<deviceId>"`. Stamps are fixed width, so they compare as strings. Rows written before version 4 got a `legacy` stamp when the database upgraded.

`tombstones` (one row per deleted synced row): `{ id: "<store>:<key>", store, key, stamp }`. A put older than a tombstone is ignored. Tombstones travel in backups and snapshots.

## Outbox row

```
{ seq: 12, opId: "001793271840718.000000.<deviceId>", stamp: "001793271840718.000000.<deviceId>",
  store: "products", op: "put", key: "<uuid>", record: { ...row, stamp },
  status: "pending", createdAt: "2026-10-29T10:00:00.000Z", attempts: 0 }
```

`opId` is the idempotency key the server stores. A row leaves the outbox only after the server confirms it (`js/core/sync.js`, `pushAll`).

Settings rows used by sync (device-only, excluded from backups): `deviceId` (existing), `syncConfig` `{ url, anonKey, email }`, `syncSession` `{ accessToken, refreshToken, expiresAt }`. `syncState` holds the server cursor under `cursor`; it is excluded from backups too.

## Browser-local UI preferences (localStorage, not business data)

- `shifa.lang`: `en` or `ur`
- `shifa.theme`: `auto`, `light` or `dark`


## Shifts (cash drawer), schema 8

- shifts: one row per shift on this device (id, number, status open or closed, openedAt, openedBy, openingCash, closedAt, closedBy, counted, expected, variance, closingNote, corrections). Device-local, never synced.
- shiftMovements: cash moved during a shift (type payIn, payOut, petty or cashDrop, amount, reason, account, entryId). Device-local.
- ledgerEntries.shiftId: every ledger line posted while a shift is open carries that shift id (new index). Synced like the rest of the ledger; ids from other devices simply match no local shift.
- expected drawer = opening float plus the net cash (account 1000) tagged with the shift. variance = counted minus expected.
