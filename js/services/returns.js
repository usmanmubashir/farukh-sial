// Returns, always made from an original document.
//
// Sale return: units go back into the batches the sale took them from. Allocations are used in FEFO order,
//   so a partial return restores the earliest batch first. Each allocation tracks what it has given back.
//   Value: the returned share of the sale total (tax included), split into net, tax and cost.
//   Refund: cash handed back now. Any remainder is credited to the customer's receivable.
//   A walk-in sale (no customer) must be refunded in full.
//
// Purchase return: packs leave a specific purchase batch, expired or not. Stock can only leave a batch that
//   actually holds it, so a return can fail with insufficientStock if the batch has been sold through.
//   Value: packs × costPerPack. Refund: cash back now. The rest reduces the supplier payable.
import * as db from '../core/db.js';
import { todayISO } from '../core/dates.js';
import { roundHalfAway, sum } from '../core/money.js';
import { ServiceError, missing, optionalInt, requireInt } from './errors.js';
import { applyMovementIn, batchRows, costOfUnits } from './stock.js';
import { postEntryIn, purchaseReturnLines, saleReturnLines } from './ledger.js';
import { nextDocNumber } from './numbering.js';

/**
 * input: { saleId, items: [{ saleItemId, units }], refund, reason, date, note }
 * saleItemId comes from the original sale. Units are base units (tablets), so a loose return needs no pack maths.
 */
export async function createSaleReturnIn(ctx, input) {
  const date = input.date ?? input.today ?? todayISO();
  const sale = await ctx.get('sales', input.saleId);
  if (!sale) throw missing('sale', input.saleId);
  if (sale.status === 'void') throw new ServiceError('saleVoided');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ServiceError('emptyReturn');

  const returnId = db.newId();
  const saleItems = await ctx.getAll('saleItems', { index: 'saleId', query: sale.id });
  const touched = new Map(); // saleItem id → working copy
  const lines = [];

  for (const req of input.items) {
    const units = requireInt(req.units, 'units', 1);
    const original = saleItems.find((item) => item.id === req.saleItemId);
    if (!original) throw missing('saleItem', req.saleItemId);
    const item = touched.get(original.id) ?? {
      ...original,
      allocations: original.allocations.map((a) => ({ ...a })),
    };
    touched.set(original.id, item);

    const remaining = item.units - item.returnedUnits;
    if (units > remaining) throw new ServiceError('returnExceedsSold', { product: item.productName, remaining });

    // Give units back to the batches in the order they were taken.
    let left = units;
    let itemCost = 0;
    const restored = [];
    for (const a of item.allocations) {
      if (left === 0) break;
      const take = Math.min(a.units - a.returnedUnits, left);
      if (take <= 0) continue;
      await applyMovementIn(ctx, {
        productId: item.productId,
        batchId: a.batchId,
        units: take,
        type: 'sale_return',
        docType: 'saleReturn',
        docId: returnId,
        date,
      });
      a.returnedUnits += take;
      left -= take;
      itemCost += costOfUnits(a.costPerPack, a.unitsPerPack, take);
      restored.push({ batchId: a.batchId, batchNo: a.batchNo, units: take });
    }

    // Value: the share of the item, scaled by the sale-level discount and tax.
    const gross = roundHalfAway(((item.amount * units) / item.units) * (sale.total / sale.subtotal));
    const tax = sale.total > 0 ? roundHalfAway((gross * sale.tax) / sale.total) : 0;

    item.returnedUnits += units;
    item.returnedAmount += gross;
    lines.push({
      id: db.newId(),
      returnId,
      saleItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      units,
      amount: gross,
      tax,
      net: gross - tax,
      cost: itemCost,
      restored,
    });
  }

  const gross = sum(lines.map((l) => l.amount));
  const tax = sum(lines.map((l) => l.tax));
  const cost = sum(lines.map((l) => l.cost));
  const refund = optionalInt(input.refund, 'refund', 0, 0);
  if (refund > gross) throw new ServiceError('refundExceedsReturn', { gross, refund });
  if (!sale.customerId && refund !== gross) throw new ServiceError('walkInRefundMustMatch', { gross });
  const credit = gross - refund;

  const number = await nextDocNumber(ctx, 'saleReturn');
  const entryId = await postEntryIn(ctx, {
    date,
    docType: 'saleReturn',
    docId: returnId,
    memo: number,
    lines: saleReturnLines({ net: gross - tax, tax, refund, credit, cost, customerId: sale.customerId }),
  });

  for (const item of touched.values()) ctx.put('saleItems', item);
  const allReturned = saleItems.every((item) => (touched.get(item.id) ?? item).returnedUnits === item.units);
  ctx.put('sales', {
    ...sale,
    returnedTotal: sale.returnedTotal + gross,
    status: allReturned ? 'returned' : 'partially_returned',
  });
  const doc = ctx.put('returns', {
    id: returnId,
    number,
    type: 'sale',
    date,
    saleId: sale.id,
    customerId: sale.customerId,
    gross,
    tax,
    net: gross - tax,
    refund,
    credit,
    cost,
    reason: String(input.reason ?? '').trim(),
    note: String(input.note ?? '').trim(),
    entryId,
  });
  for (const line of lines) ctx.put('returnItems', line);
  return { ...doc, items: lines };
}

export function createSaleReturn(input) {
  return db.transaction((ctx) => createSaleReturnIn(ctx, input));
}

/**
 * input: { purchaseId, items: [{ purchaseItemId, packs }], refund, reason, date, note }
 */
export async function createPurchaseReturnIn(ctx, input) {
  const date = input.date ?? input.today ?? todayISO();
  const purchase = await ctx.get('purchases', input.purchaseId);
  if (!purchase) throw missing('purchase', input.purchaseId);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ServiceError('emptyReturn');

  const returnId = db.newId();
  const purchaseItems = await ctx.getAll('purchaseItems', { index: 'purchaseId', query: purchase.id });
  const touched = new Map();
  const lines = [];

  for (const req of input.items) {
    const packs = requireInt(req.packs, 'packs', 1);
    const original = purchaseItems.find((item) => item.id === req.purchaseItemId);
    if (!original) throw missing('purchaseItem', req.purchaseItemId);
    const item = touched.get(original.id) ?? { ...original };
    touched.set(original.id, item);

    const remaining = item.packs - item.returnedPacks;
    if (packs > remaining) throw new ServiceError('returnExceedsBought', { product: item.productName, remaining });

    const product = await ctx.get('products', item.productId);
    const units = packs * product.unitsPerPack;
    await applyMovementIn(ctx, {
      productId: item.productId,
      batchId: item.batchId,
      units: -units,
      type: 'purchase_return',
      docType: 'purchaseReturn',
      docId: returnId,
      date,
    });

    item.returnedPacks += packs;
    lines.push({
      id: db.newId(),
      returnId,
      purchaseItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      batchId: item.batchId,
      batchNo: item.batchNo,
      packs,
      units,
      amount: packs * item.costPerPack,
    });
  }

  const value = sum(lines.map((l) => l.amount));
  const refund = optionalInt(input.refund, 'refund', 0, 0);
  if (refund > value) throw new ServiceError('refundExceedsReturn', { gross: value, refund });
  if (!purchase.supplierId && refund !== value) throw new ServiceError('walkInRefundMustMatch', { gross: value });

  const number = await nextDocNumber(ctx, 'purchaseReturn');
  const entryId = await postEntryIn(ctx, {
    date,
    docType: 'purchaseReturn',
    docId: returnId,
    memo: number,
    lines: purchaseReturnLines({ value, refund, payableReduce: value - refund, supplierId: purchase.supplierId }),
  });

  for (const item of touched.values()) ctx.put('purchaseItems', item);
  ctx.put('purchases', { ...purchase, returnedValue: (purchase.returnedValue ?? 0) + value });
  const doc = ctx.put('returns', {
    id: returnId,
    number,
    type: 'purchase',
    date,
    purchaseId: purchase.id,
    supplierId: purchase.supplierId,
    gross: value,
    tax: 0,
    net: value,
    refund,
    credit: value - refund,
    cost: value,
    reason: String(input.reason ?? '').trim(),
    note: String(input.note ?? '').trim(),
    entryId,
  });
  for (const line of lines) ctx.put('returnItems', line);
  return { ...doc, items: lines };
}

export function createPurchaseReturn(input) {
  return db.transaction((ctx) => createPurchaseReturnIn(ctx, input));
}

export const getReturn = (id) => db.get('returns', id);

export async function getReturnWithItems(id) {
  const doc = await db.get('returns', id);
  if (!doc) throw missing('return', id);
  const items = await db.getAll('returnItems', { index: 'returnId', query: id });
  return { ...doc, items };
}

/** Returns in a date range, newest first. type: '' (both), 'sale' or 'purchase'. */
export async function listReturns({ from = '', to = '￿', type = '' } = {}) {
  const rows = await db.getAll('returns', { index: 'date', query: IDBKeyRange.bound(from, to) });
  return rows
    .filter((row) => !type || row.type === type)
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
}

/**
 * Sends expired batches back to their suppliers, one purchase return per purchase.
 * Batches with no purchase line (opening stock) cannot be returned and are counted. Loose units that do
 * not make a whole pack stay on the shelf. Walk-in purchases are refunded in cash, supplier purchases credit the payable.
 */
export async function returnExpiredBatches(batchIds, { today = todayISO() } = {}) {
  const rows = (await batchRows({ today })).filter((row) => batchIds.includes(row.batchId));
  const noPurchase = rows.filter((row) => !row.purchaseItemId).length;
  const byPurchase = new Map();
  let leftoverUnits = 0;
  for (const row of rows) {
    if (!row.purchaseItemId) continue;
    leftoverUnits += row.units % row.unitsPerPack;
    if (row.packs < 1) continue;
    const list = byPurchase.get(row.purchaseId) ?? [];
    list.push(row);
    byPurchase.set(row.purchaseId, list);
  }

  let created = 0;
  for (const [purchaseId, lines] of byPurchase) {
    const purchase = await db.get('purchases', purchaseId);
    const value = sum(lines.map((row) => row.packs * row.costPerPack));
    await createPurchaseReturn({
      purchaseId,
      items: lines.map((row) => ({ purchaseItemId: row.purchaseItemId, packs: row.packs })),
      refund: purchase?.supplierId ? 0 : value,
      reason: 'Expired stock',
      date: today,
    });
    created += 1;
  }
  return { created, noPurchase, leftoverUnits };
}
