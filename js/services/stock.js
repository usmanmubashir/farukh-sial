// Batch stock with FEFO (first-expiry-first-out).
//
// Truth: stockMovements. Every change to stock is a movement row with a signed `units` value.
//        Stock of a batch = sum of its movements. Stock of a product = sum over its batches.
// Cache: batches.onHand mirrors the movement sum, so FEFO can read it without scanning history.
//        Only applyMovementIn() writes it. recalculateStock() rebuilds it, and checkIntegrity() compares it.
//
// Rules:
//   - Expired batches (expiry < today) are never allocated to a sale.
//   - A batch never goes below zero. Stock can not be created by a sale, only moved.
//   - Quantities are integer units (tablets, ml). Packs are a display concern: see splitUnits().
//
// Functions ending in "In" take the caller's transaction context (ctx), so services can compose several
// writes atomically. The plain names run their own transaction.
import * as db from '../core/db.js';
import { expiryState, expiryFromInput, parseISODate, todayISO } from '../core/dates.js';
import { roundHalfAway, sum } from '../core/money.js';
import { ServiceError, missing, optionalInt, requireInt, requireText } from './errors.js';
import { postEntryIn, adjustmentLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';

/* ---------- Pure helpers ---------- */

export function unitsFromPacks(product, packs, looseUnits = 0) {
  return packs * product.unitsPerPack + looseUnits;
}

/** Splits units into whole packs and loose units. Negative values keep their sign. */
export function splitUnits(units, unitsPerPack) {
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  return {
    units,
    packs: sign * Math.floor(abs / unitsPerPack),
    looseUnits: sign * (abs % unitsPerPack),
  };
}

/** Cost of `units` taken from a batch bought at costPerPack. Rounded half away from zero, per allocation. */
export function costOfUnits(costPerPack, unitsPerPack, units) {
  return roundHalfAway((costPerPack * units) / unitsPerPack);
}

/** First-expiry-first-out order, then oldest receipt, then id so the order is stable. */
export const fefoOrder = (a, b) =>
  a.expiry.localeCompare(b.expiry) || (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '') || a.id.localeCompare(b.id);

function sumBy(rows, key, field) {
  const totals = new Map();
  for (const row of rows) totals.set(row[key], (totals.get(row[key]) ?? 0) + row[field]);
  return totals;
}

/* ---------- Writes inside a transaction ---------- */

/** The only writer of movements and of batches.onHand. */
export async function applyMovementIn(ctx, { productId, batchId, units, type, docType = null, docId = null, date = todayISO(), note = '' }) {
  if (!Number.isSafeInteger(units) || units === 0) throw new ServiceError('invalidField', { field: 'units' });
  const batch = await ctx.get('batches', batchId);
  if (!batch || batch.productId !== productId) throw missing('batch', batchId);
  const available = batch.onHand ?? 0;
  if (available + units < 0) throw new ServiceError('insufficientStock', { available, requested: -units });
  ctx.put('batches', { ...batch, onHand: available + units });
  return ctx.put('stockMovements', {
    id: db.newId(),
    productId,
    batchId,
    units,
    type,
    docType,
    docId,
    date,
    note,
  });
}

/** Adds a batch and its opening movement. `units` is in units, `mrp` and `costPerPack` in paisa per pack. */
export async function addBatchIn(ctx, input) {
  const product = await ctx.get('products', input.productId);
  if (!product) throw missing('product', input.productId);
  const batchNo = requireText(input.batchNo, 'batchNo');
  const expiry = expiryFromInput(input.expiry);
  if (!expiry) throw new ServiceError('invalidField', { field: 'expiry' });
  const units = requireInt(input.units, 'units', 1);
  const date = input.date ?? todayISO();
  const batch = ctx.put('batches', {
    id: db.newId(),
    productId: product.id,
    batchNo,
    expiry,
    costPerPack: optionalInt(input.costPerPack, 'costPerPack', 0, 0),
    mrp: optionalInt(input.mrp, 'mrp', 0, product.salePricePerPack),
    receivedAt: date,
    onHand: 0,
  });
  await applyMovementIn(ctx, {
    productId: product.id,
    batchId: batch.id,
    units,
    type: input.type ?? 'purchase',
    docType: input.docType ?? null,
    docId: input.docId ?? null,
    date,
  });
  return ctx.get('batches', batch.id);
}

/**
 * Chooses batches for `units` in FEFO order. Only batches that have not expired and have stock are eligible.
 * Throws without changing anything when the sellable stock is short. Returns the allocations, not yet applied.
 */
export async function allocateFEFOIn(ctx, productId, units, { today = todayISO(), batchId = null } = {}) {
  const product = await ctx.get('products', productId);
  if (!product) throw missing('product', productId);
  const batches = await ctx.getAll('batches', { index: 'productId', query: productId });
  // A manual batch choice still has to be sellable: in stock and not expired.
  if (batchId) {
    const chosen = batches.find((b) => b.id === batchId);
    if (!chosen) throw missing('batch', batchId);
    if (chosen.expiry < today) throw new ServiceError('batchExpired', { batchNo: chosen.batchNo });
  }
  const sellable = batches
    .filter((b) => (b.onHand ?? 0) > 0 && b.expiry >= today && (!batchId || b.id === batchId))
    .sort(fefoOrder);
  const available = sellable.reduce((total, b) => total + b.onHand, 0);
  if (available < units) throw new ServiceError('insufficientStock', { available, requested: units });

  const allocations = [];
  let left = units;
  for (const batch of sellable) {
    if (left === 0) break;
    const take = Math.min(batch.onHand, left);
    allocations.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      expiry: batch.expiry,
      units: take,
      costPerPack: batch.costPerPack ?? 0,
      mrp: batch.mrp ?? 0,
      unitsPerPack: product.unitsPerPack,
      returnedUnits: 0,
    });
    left -= take;
  }
  return allocations;
}

/** Allocates FEFO and applies the movements. Returns the allocations. */
export async function consumeIn(ctx, productId, units, { type = 'consume', docType = null, docId = null, date, today } = {}) {
  const allocations = await allocateFEFOIn(ctx, productId, units, { today });
  for (const a of allocations) {
    await applyMovementIn(ctx, { productId, batchId: a.batchId, units: -a.units, type, docType, docId, date });
  }
  return allocations;
}

export async function unitsOfProductIn(ctx, productId) {
  const rows = await ctx.getAll('stockMovements', { index: 'productId', query: productId });
  return rows.reduce((total, row) => total + row.units, 0);
}

/* ---------- Public operations (own transaction) ---------- */

/** Adds stock as a new batch. Input: { productId, batchNo, expiry ('MM/YY' or ISO), packs, looseUnits, costPerPack, mrp }. */
export function addBatch(input) {
  return db.transaction(async (ctx) => {
    const product = await ctx.get('products', input.productId);
    if (!product) throw missing('product', input.productId);
    const packs = requireInt(input.packs ?? 0, 'packs', 0);
    const looseUnits = requireInt(input.looseUnits ?? 0, 'looseUnits', 0);
    const units = unitsFromPacks(product, packs, looseUnits);
    return addBatchIn(ctx, { ...input, units, type: input.type ?? 'opening', docType: 'opening' });
  });
}

/** Sells or consumes `units` of a product in FEFO order. Returns the allocations. */
export function consume(productId, units, options = {}) {
  return db.transaction((ctx) => consumeIn(ctx, productId, requireInt(units, 'units', 1), options));
}

/**
 * Manual stock adjustment with a reason. Negative: pick a batch explicitly, or leave batchId out to take FEFO.
 * Positive: needs batchId, because a new unit must land in a batch with a known expiry and cost.
 * Posts the value to the ledger (General Expenses or Other Income) and records an ADJ voucher.
 */
export function adjust({ productId = null, batchId = null, units, reason, date = todayISO(), today = todayISO() }) {
  return db.transaction(async (ctx) => {
    const note = requireText(reason, 'reason');
    if (!Number.isSafeInteger(units) || units === 0) throw new ServiceError('invalidField', { field: 'units' });
    const docId = db.newId();
    const moved = [];

    if (batchId) {
      const batch = await ctx.get('batches', batchId);
      if (!batch) throw missing('batch', batchId);
      const product = await ctx.get('products', batch.productId);
      await applyMovementIn(ctx, { productId: batch.productId, batchId, units, type: 'adjust', docType: 'adjustment', docId, date, note });
      moved.push({ costPerPack: batch.costPerPack ?? 0, unitsPerPack: product.unitsPerPack, units: Math.abs(units) });
    } else {
      if (units > 0) throw new ServiceError('batchRequired');
      const product = await ctx.get('products', productId);
      if (!product) throw missing('product', productId);
      const allocations = await consumeIn(ctx, productId, -units, { type: 'adjust', docType: 'adjustment', docId, date, today });
      for (const a of allocations) moved.push({ costPerPack: a.costPerPack, unitsPerPack: a.unitsPerPack, units: a.units });
    }

    const direction = units < 0 ? 'out' : 'in';
    const value = sum(moved.map((m) => costOfUnits(m.costPerPack, m.unitsPerPack, m.units)));
    const number = await nextDocNumber(ctx, 'adjustment');
    const entryId = value > 0 ? await postEntryIn(ctx, { date, docType: 'adjustment', docId, memo: number, lines: adjustmentLines({ value, direction }) }) : null;
    return ctx.put('vouchers', { id: docId, number, type: 'adjustment', date, amount: value, direction, note, entryId });
  });
}

/* ---------- Reads ---------- */

/** Stock of a product from movements: units, whole packs and loose units. */
export async function stockOf(productId) {
  const product = await db.get('products', productId);
  if (!product) throw missing('product', productId);
  const rows = await db.getAll('stockMovements', { index: 'productId', query: productId });
  const units = rows.reduce((total, row) => total + row.units, 0);
  return { productId, ...splitUnits(units, product.unitsPerPack), unitsPerPack: product.unitsPerPack };
}

/** Stock per batch from movements, in FEFO order. Expired batches are included and flagged. */
export async function batchStock(productId, { today = todayISO() } = {}) {
  const batches = await db.getAll('batches', { index: 'productId', query: productId });
  const movements = await db.getAll('stockMovements', { index: 'productId', query: productId });
  const totals = sumBy(movements, 'batchId', 'units');
  return batches
    .map((b) => ({
      batchId: b.id,
      batchNo: b.batchNo,
      expiry: b.expiry,
      units: totals.get(b.id) ?? 0,
      costPerPack: b.costPerPack,
      mrp: b.mrp,
      expired: b.expiry < today,
    }))
    .sort(fefoOrder);
}

async function unitsByProduct() {
  return sumBy(await db.getAll('stockMovements'), 'productId', 'units');
}

/** Active products with a reorder level whose stock has fallen below it. */
export async function lowStock() {
  const totals = await unitsByProduct();
  const products = await db.getAll('products');
  return products
    .filter((p) => p.active && p.reorderLevel > 0)
    .map((p) => ({ product: p, ...splitUnits(totals.get(p.id) ?? 0, p.unitsPerPack) }))
    .filter((row) => row.units < row.product.reorderLevel * row.product.unitsPerPack);
}

/** Active products with no units left. */
export async function outOfStock() {
  const totals = await unitsByProduct();
  const products = await db.getAll('products');
  return products
    .filter((p) => p.active && (totals.get(p.id) ?? 0) <= 0)
    .map((p) => ({ product: p, units: 0 }));
}

/** Batches with stock that expire within `days` (or have already expired). */
export async function expiringSoon(days, { today = todayISO() } = {}) {
  const batches = await db.getAll('batches');
  const totals = sumBy(await db.getAll('stockMovements'), 'batchId', 'units');
  const limit = days ?? (await db.getSetting('business', {})).expiryWarnDays ?? 90;
  return batches
    .filter((b) => (totals.get(b.id) ?? 0) > 0)
    .filter((b) => ['expired', 'soon'].includes(expiryState(b.expiry, { today, warnDays: limit })))
    .map((b) => ({ batchId: b.id, productId: b.productId, batchNo: b.batchNo, expiry: b.expiry, units: totals.get(b.id) }));
}

/** Rebuilds batches.onHand from movements. Returns what changed. */
export function recalculateStock() {
  return db.transaction(async (ctx) => {
    const batches = await ctx.getAll('batches');
    const totals = sumBy(await ctx.getAll('stockMovements'), 'batchId', 'units');
    const corrected = [];
    for (const batch of batches) {
      const computed = totals.get(batch.id) ?? 0;
      if ((batch.onHand ?? 0) !== computed) {
        corrected.push({ batchId: batch.id, before: batch.onHand ?? 0, after: computed });
        ctx.put('batches', { ...batch, onHand: computed });
      }
    }
    return { checked: batches.length, corrected };
  });
}

/** Compares the cached batch totals with the movements. Read-only. */
export async function checkIntegrity() {
  const batches = await db.getAll('batches');
  const movements = await db.getAll('stockMovements');
  const totals = sumBy(movements, 'batchId', 'units');
  const known = new Set(batches.map((b) => b.id));

  const mismatches = [];
  for (const batch of batches) {
    const cached = batch.onHand ?? 0;
    const computed = totals.get(batch.id) ?? 0;
    if (cached !== computed || computed < 0) {
      mismatches.push({ batchId: batch.id, productId: batch.productId, batchNo: batch.batchNo, cached, computed });
    }
  }
  const orphanMovements = movements.filter((m) => !known.has(m.batchId)).length;
  return { ok: mismatches.length === 0 && orphanMovements === 0, checkedBatches: batches.length, mismatches, orphanMovements };
}

/* ---------- Views for the Stock and Expiry screens ---------- */

/** Days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from, to) {
  return Math.round((parseISODate(to) - parseISODate(from)) / 86400000);
}

/** Expiry bucket for a number of days left: expired, d30, d60, d90, m6 (91-180) or later. */
export function bucketOf(days) {
  if (days < 0) return 'expired';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  if (days <= 180) return 'm6';
  return 'later';
}

/** Manual adjustments for one product, newest first: units, reason and date. */
export async function adjustmentHistory(productId) {
  const rows = await db.getAll('stockMovements', { index: 'productId', query: productId });
  return rows
    .filter((row) => row.type === 'adjust')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map((row) => ({ id: row.id, units: row.units, note: row.note ?? '', date: row.date, batchId: row.batchId }));
}

/**
 * Batch rows with their stock from movements, value at cost and retail, days to expiry, and the purchase
 * line they came from (purchaseItemId), which a supplier return needs. Sorted first-expiry-first.
 */
export async function batchRows({ productId = null, withStockOnly = true, today = todayISO() } = {}) {
  const [batches, movements, purchaseItems, products] = await Promise.all([
    productId ? db.getAll('batches', { index: 'productId', query: productId }) : db.getAll('batches'),
    db.getAll('stockMovements'),
    db.getAll('purchaseItems'),
    db.getAll('products'),
  ]);
  const totals = sumBy(movements, 'batchId', 'units');
  const purchaseByBatch = new Map(purchaseItems.map((pi) => [pi.batchId, pi]));
  const productById = new Map(products.map((p) => [p.id, p]));

  return batches
    .map((b) => {
      const product = productById.get(b.productId);
      const perPack = product?.unitsPerPack ?? 1;
      const units = totals.get(b.id) ?? 0;
      const line = purchaseByBatch.get(b.id);
      const days = daysBetween(today, b.expiry);
      return {
        batchId: b.id,
        productId: b.productId,
        productName: product?.name ?? '',
        product,
        batchNo: b.batchNo,
        expiry: b.expiry,
        units,
        unitsPerPack: perPack,
        packs: Math.trunc(units / perPack),
        looseUnits: units % perPack,
        costPerPack: b.costPerPack ?? 0,
        costValue: costOfUnits(b.costPerPack ?? 0, perPack, units),
        retailValue: costOfUnits(product?.salePricePerPack ?? 0, perPack, units),
        days,
        bucket: bucketOf(days),
        purchaseItemId: line?.id ?? null,
        purchaseId: line?.purchaseId ?? null,
      };
    })
    .filter((row) => !withStockOnly || row.units > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.batchNo.localeCompare(b.batchNo));
}
