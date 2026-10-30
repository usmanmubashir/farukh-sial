// Merge rules for changes that arrive from other devices. Runs inside db.replicate(), so nothing is sent back.
//  - Each synced row keeps the stamp of its last change. A put applies only when its stamp is newer than the row's
//    stamp and newer than any tombstone (last writer wins, ordered by stamp then device id).
//  - A delete removes the row and leaves a tombstone with its stamp, so an older copy cannot bring it back.
//  - Stock movements and ledger lines are never edited, so they merge without loss: every device ends up with the
//    same set of them.
//  - batches.onHand is a cache of the movements. After a merge it is recomputed from the movements, so two devices
//    that both sold from one batch both count.
//  - A row whose unique value (document number, account code) is already taken by another row is not written. It is
//    reported as an issue instead. Per-device document prefixes make this rare.
import * as db from '../core/db.js';
import { SYNCED_STORES, tombstoneId } from '../core/db.js';

/** Unique fields per store. A clash is reported instead of failing the whole batch. */
const UNIQUE_FIELDS = { sales: 'number', purchases: 'number', returns: 'number', vouchers: 'number', accounts: 'code', practices: 'number', practiceVoids: 'practiceId', users: 'username' };

/**
 * Applies ops in order. Each op: { store, op: 'put' | 'delete', key, record?, stamp }.
 * Returns { applied, skipped, issues, batches, touched } where batches holds the batch ids whose stock must be
 * recomputed and touched holds the store names that changed.
 */
export async function applyOps(ctx, ops) {
  const result = { applied: 0, skipped: 0, issues: [], batches: new Set(), touched: new Set() };
  for (const op of ops) {
    if (!SYNCED_STORES.includes(op.store)) {
      result.skipped += 1;
      continue;
    }
    const id = tombstoneId(op.store, op.key);
    const [tomb, current] = await Promise.all([ctx.get('tombstones', id), ctx.get(op.store, op.key)]);
    const currentStamp = current?.stamp ?? '';
    const tombStamp = tomb?.stamp ?? '';

    if (op.store === 'batches') result.batches.add(op.key);
    if (op.store === 'stockMovements') result.batches.add(op.record?.batchId ?? current?.batchId);

    if (op.op === 'delete') {
      if (currentStamp > op.stamp || tombStamp >= op.stamp) {
        result.skipped += 1;
        continue;
      }
      if (current) {
        ctx.remove(op.store, op.key);
        result.touched.add(op.store);
      }
      ctx.put('tombstones', { id, store: op.store, key: op.key, stamp: op.stamp });
      result.applied += 1;
      continue;
    }

    if (currentStamp >= op.stamp || tombStamp >= op.stamp) {
      result.skipped += 1;
      continue;
    }
    const record = { ...op.record, stamp: op.stamp };
    const unique = UNIQUE_FIELDS[op.store];
    if (unique && record[unique] !== undefined) {
      const holders = await ctx.getAll(op.store, { index: unique, query: record[unique] });
      if (holders.some((row) => row.id !== record.id)) {
        result.issues.push({ kind: 'duplicate', store: op.store, key: op.key, value: String(record[unique]) });
        result.skipped += 1;
        continue;
      }
    }
    ctx.put(op.store, record);
    if (tomb) ctx.remove('tombstones', id);
    result.touched.add(op.store);
    result.applied += 1;
  }
  return result;
}

/**
 * Recomputes batches.onHand from the movements for the given batch ids. Returns the negative-stock issues found.
 * A negative figure means two devices sold more than the batch held while offline. It is reported, not hidden.
 */
export async function recalcBatches(ctx, batchIds) {
  const issues = [];
  for (const batchId of batchIds) {
    if (!batchId) continue;
    const batch = await ctx.get('batches', batchId);
    if (!batch) continue;
    const movements = await ctx.getAll('stockMovements', { index: 'batchId', query: batchId });
    const onHand = movements.reduce((sum, movement) => sum + movement.units, 0);
    if (onHand !== (batch.onHand ?? 0)) ctx.put('batches', { ...batch, onHand });
    if (onHand < 0) {
      issues.push({ kind: 'negative-stock', store: 'batches', key: batchId, productId: batch.productId, onHand });
    }
  }
  return issues;
}

/** Every synced store plus tombstones, as rows. Used to build a snapshot for new devices. */
export async function snapshotStores() {
  const stores = {};
  for (const name of [...SYNCED_STORES, 'tombstones']) stores[name] = await db.getAll(name);
  return stores;
}

/** Converts snapshot rows of one store into ops, so they go through the same merge rules as live changes. */
export function snapshotOps(store, rows) {
  if (store === 'tombstones') {
    return rows.map((row) => ({ store: row.store, op: 'delete', key: row.key, stamp: row.stamp }));
  }
  return rows.map((row) => ({ store, op: 'put', key: row.id, record: row, stamp: row.stamp ?? '' }));
}
