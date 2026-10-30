# Sync

Shifa Pharmacy POS works offline first. Every business record is written to the device database and queued in an outbox, in the same IndexedDB transaction as the write. Sync sends the queue to a server and applies other devices' changes when it can. No screen waits for the network.

Code: `js/core/sync.js` (engine), `js/core/sync-supabase.js` (adapter), `js/services/replication.js` (merge rules), `js/core/db.js` (stamps, outbox, tombstones, `replicate()`), `js/pages/_sync-sheet.js` (sync details), Settings → Sync.

## What is guaranteed

- **Airplane mode works.** Sales, purchases, returns and vouchers all save locally and queue. Nothing is lost when the phone or computer restarts.
- **Reconnecting sends the queue.** The `online` event starts a sync by itself. The test in `tests/sync-sim.html` checks this without calling sync by hand.
- **Two devices converge.** Both end up with the same synced data, byte for byte. The simulation checks this on every run.
- **Ledgers stay balanced.** Each document posts its own balanced entries, and merging only adds whole entries, so the trial balance difference stays at zero on every device.
- **Stock is never typed in.** Each batch's stock is the sum of its movements. Movements are never edited, so two devices' sales both count.
- **A retry never doubles a change.** Each change has an id (`opId`), and the server ignores an id it already holds.

## What is not guaranteed (read this)

- **Two devices that both sell the last units offline can oversell.** Each device checks its own stock when it sells, so neither can see the other's sale. After the merge the batch goes below zero. The engine does not hide this: the batch shows a negative figure and the sync sheet lists a "Stock went below zero" item. The simulation checks exactly this case. A stricter rule (reserve stock per device, or refuse the second sale on merge) is a product decision, so it is left open.
- **Document numbers need a device prefix.** Each device numbers its own documents (`SALE-0001`). Without a prefix, two devices can issue the same number, and the second copy is not stored: it is listed as a sync issue. Set a device prefix in Settings → Pharmacy rules on every device before you enable sync.
- **Pharmacy settings are per device.** Profile, rules, printer and document prefixes stay on the device. Only business records (medicines, batches, stock movements, customers, suppliers, sales, purchases, returns, accounts, ledger lines, vouchers, order list, Rx register) are synced.
- **Last writer wins for a record edited on two devices.** If two devices edit the same medicine's price while offline, the later change wins. Stock and ledger lines are never lost this way.
- **Background Sync needs a window.** The browser may wake the service worker with the `shifa-sync` tag. The worker then asks an open app window to sync. With no window open, the sync runs when the app next opens.

## Backends

Two servers are supported, and the engine does not change between them:

- **Cloudflare (Worker + D1)**, the default for new setups. See `docs/CLOUDFLARE.md`. Sign-in sends a password proof derived on the device. No snapshots: a new device replays the op log.
- **Supabase**, the older option. See `docs/supabase.sql`.

Both connect through Settings → Sync. The first connect uploads every record already on the device (`sync.queueExisting`), so data made before sync reaches the server. Joining an existing pharmacy from an empty device skips the upload (`sync.joinPharmacy`).

Staff accounts (`users`) are synced records, so their password changes and access changes reach every device.

## Identity, stamps and the outbox

Every write to a business record stamps the row: `stamp = wall-clock ms . counter . deviceId`, for example `001793271840718.000000.d413dd73-…`. Stamps are fixed width, so comparing two as strings orders them. The clock is a hybrid logical clock (`db.js: stamp()`, `observe()`): it moves past every stamp the device receives, so a later local change always sorts after the change it saw.

Each outbox row holds one change:

```
{ seq, opId, stamp, store, op: "put" | "delete", key, record?, status: "pending", createdAt, attempts }
```

`opId` is the stamp. It is unique per device, so it works as the idempotency key. Rows leave the outbox only after the server confirms them (`pushAll`), in batches of 200.

Rows written before sync existed got stamps from their own times when the database upgraded to version 4 (`legacy` device), so they order correctly.

## Merge rules (`js/services/replication.js`)

Remote changes go through `db.replicate()`. Rows are stored as they arrive, nothing is queued again, and the stamp of each row is kept.

| Change | Rule |
|---|---|
| Put (create or edit) | Applies only if its stamp is newer than the row's stamp and than any tombstone for it. Last writer wins. |
| Delete | Removes the row and leaves a tombstone with the delete's stamp, so an older copy cannot bring it back. A newer local edit keeps the row. |
| Stock movement, ledger line | Never edited, so each one merges by id. Every device ends with the same set. |
| Batch `onHand` | A cache. After a merge it is recalculated from the movements of each touched batch. |
| Unique number or account code | If another row already holds the value, the incoming row is not stored and an issue is recorded. |
| Default accounts | Written with the fixed stamp `SEED_STAMP` on every device. They are the same baseline everywhere and are not queued. |

After a merge that touches sales, sale lines or ledger lines, the report rollups are rebuilt, so reports match the data on that device.

## Engine (`js/core/sync.js`)

One run = **auth → push → pull → maybe snapshot**.

- **Auth** refreshes the access token when it is close to expiring. A rejected token stops automatic retries and asks for sign-in again.
- **Push** sends the outbox in batches, then deletes what the server confirmed.
- **Pull** asks for ops after the stored server cursor, 500 at a time. Each page is applied and the new cursor is stored in the same transaction, so a crash never skips a change.
- **Snapshot** (below) is published when the server is far ahead of the last snapshot.

Runs never block the UI. They are asynchronous, a call during a run waits for one more run afterwards, and a failure schedules a retry with exponential backoff (2 s, 4 s, … up to 5 minutes).

### Triggers

| Trigger | When |
|---|---|
| Start | `sync.init()` at boot, when a server is configured |
| Reconnect | the `online` event |
| After a write | 3 seconds after the last synced change (debounced) |
| Periodic | every 60 seconds while online |
| Background Sync | after each change, the page registers the `shifa-sync` tag; the service worker asks an open window to sync |
| Manual | "Sync now" in the sync sheet, or in Settings |

### Status

The header pill shows **Offline**, **Saved on this device** (no server configured, changes waiting), **Syncing** (pulses), **Synced** (flashes green when a run finishes), or **Sync error** (tap to retry). Tapping the pill opens the sync sheet: connection, changes waiting, last sync, the last error, and things to check.

## Bootstrap and snapshots

A new device has no cursor. It loads the newest complete snapshot, then pulls the ops after the snapshot's cursor, so it never replays the whole history.

A snapshot is chunks of every synced store plus tombstones, 300 rows per chunk. The last chunk written is a `_meta` row, and only a snapshot with that row is used. A device publishes one when the server cursor is 2000 or more ops past the last snapshot and its own outbox is empty. Old snapshots and old ops are kept; the server never compacts the op log.

## Server (Supabase) and security

The adapter (`js/core/sync-supabase.js`) is plain `fetch` against the Auth and REST endpoints. No SDK, no build step.

- **No secret in the code or the repository.** The project address and anon key are typed into Settings and stored on the device only (`syncConfig`).
- **The password is used once** to sign in. Only the refresh token is kept (`syncSession`). Both are device-only settings: they are never in backups.
- **Row-level security per pharmacy** (`docs/supabase.sql`). Each sign-in account belongs to one pharmacy. A trigger stamps every row with that pharmacy, and policies allow reads and inserts only for members. `ops` is append-only: clients cannot update or delete rows. The anon key alone returns nothing.
- **Sign-out** forgets the session on the device. It does not revoke it on the server; revoke it in the Supabase dashboard if a device is lost.

Setup steps are in `docs/supabase.sql` (create the account, run the two inserts, turn off public sign-up). Then in the app: Settings → Sync → address, anon key, email, password → Connect.

## Backups and restore

Backups include sync state that is part of the data (tombstones), and leave out this device's cursor (`syncState`), its pending outbox and its connection. Restoring on a device that syncs replaces its records but does not send them: the restored data is not pushed, so the server keeps its own copy until the next pull changes the record. For a clean start, restore on a new device and connect it.

## Adapter contract (for another backend)

`sync.setAdapter(adapter)` plugs in any server. The engine needs these methods:

```
auth()                                   resolves when the adapter can send (refresh tokens here)
push(ops)                                → Promise<string[]>  opIds the server holds (a repeat counts)
pull(cursor, limit)                      → { ops, cursor }    ops after the server cursor, server order
latestSnapshot()                         → { id, cursor } | null
readSnapshot(id, store, part)            → rows[]             [] when there are no more parts
writeSnapshot(id, cursor, store, part, rows)
completeSnapshot(id, cursor)             marks the snapshot usable
```

Each op is `{ opId, stamp, store, op: "put" | "delete", key, record? }`. Throw `SyncError` with `code 'auth'` when the owner must sign in again, and any other error to retry.

## Testing

- `tests/sync-sim.html` (serve the folder over http, for example `node tests/serve.mjs`, then open the page). Two devices and a third device joining later, each with its own IndexedDB, the real services and the real engine, and an in-memory server. It runs 25 changes by hand: a catalogue, offline sales, credit, a purchase, an expense, a void, price changes, an oversell case, and a snapshot bootstrap. It checks convergence, balanced ledgers, stock, price (last writer), outboxes, issues, and the oversell report. Result: 20 of 20 checks pass.
- `tests/services.test.html`: 339 assertions, including backups that refuse other schema versions.
- `node scripts/audit-shell.mjs`: the service worker's precache list matches the files on disk and its version matches the app.
- `node tests/audit-keys.mjs`: every translation key used in the code exists in English and Urdu.

## Not verified yet

- **The service worker.** Offline start is verified in headless Chrome: the app reloads with the network off and shows the setup screen. The update bar and Background Sync are not yet verified. To check them by hand in Chrome or Edge: open the app once online, then DevTools → Application → Service Workers, and turn on Offline.
- **A real Supabase project.** The adapter follows the REST and Auth contract, but it has not been run against a live project. Run `docs/supabase.sql` on a test project and sign in from two browsers first.
- **Large data.** Snapshots are built in memory; 50,000 sales has not been tried through sync.

## Open questions

1. Should oversell be prevented rather than reported? Options: reserve stock per device, or reject the second sale when it arrives.
2. Should pharmacy settings (rules, prefixes, profile) sync too? Prefixes especially should be set per device.
3. Should a restore on a synced device push its records, so the server follows the restored data?
4. Who may join a pharmacy: one owner account only, or staff accounts with their own sign-in?
