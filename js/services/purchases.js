// Purchases: stock in, one batch per line, with settings-driven price maintenance.
//
// Expiry is typed as MM/YY and stored as the last day of that month. Expired stock is refused at purchase.
// After the stock is in, the product's cost is updated from this purchase (if the setting is on), and its sale
// price follows a changed MRP (if that setting is on).
import * as db from '../core/db.js';
import { expiryFromInput, todayISO } from '../core/dates.js';
import { sum } from '../core/money.js';
import { ServiceError, missing, optionalInt, requireInt, requireText } from './errors.js';
import { addBatchIn } from './stock.js';
import { ACCOUNT, postEntryIn, purchaseLines, requirePaymentAccount } from './ledger.js';
import { nextDocNumber } from './numbering.js';
import { readSettingsIn } from './settings.js';

/**
 * input: { supplierId, items: [{ productId, batchNo, expiry, packs, costPerPack, mrp }], paid, payFrom, date, today, note }
 * payFrom is the money account the paid part leaves from (cash by default).
 * paid defaults to the full total. The rest goes to the supplier payable (a supplier is required for that).
 */
export async function createPurchaseIn(ctx, input) {
  const settings = await readSettingsIn(ctx);
  const today = input.today ?? todayISO();
  const date = input.date ?? today;
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ServiceError('emptyPurchase');

  let supplier = null;
  const supplierId = input.supplierId || null;
  if (supplierId) {
    supplier = await ctx.get('suppliers', supplierId);
    if (!supplier) throw missing('supplier', supplierId);
  }

  // 1. Validate lines.
  const lines = [];
  for (const raw of input.items) {
    const product = await ctx.get('products', raw.productId);
    if (!product) throw missing('product', raw.productId);
    if (!product.active) throw new ServiceError('productInactive', { product: product.name });
    const batchNo = requireText(raw.batchNo, 'batchNo');
    const expiry = expiryFromInput(raw.expiry);
    if (!expiry) throw new ServiceError('invalidField', { field: 'expiry' });
    if (expiry < today) throw new ServiceError('expiredBatch', { batchNo, expiry });
    const packs = requireInt(raw.packs, 'packs', 1);
    const costPerPack = requireInt(raw.costPerPack, 'costPerPack', 0);
    const mrp = optionalInt(raw.mrp, 'mrp', 0, product.salePricePerPack);
    lines.push({ productId: product.id, productName: product.name, batchNo, expiry, packs, costPerPack, mrp, units: packs * product.unitsPerPack, amount: packs * costPerPack });
  }

  // 2. Money.
  const total = sum(lines.map((line) => line.amount));
  const paid = optionalInt(input.paid, 'paid', 0, total);
  if (paid > total) throw new ServiceError('overpaid', { total, paid });
  const balance = total - paid;
  if (balance > 0 && !supplier) throw new ServiceError('supplierRequiredForCredit');
  // The money leaves the cash drawer, or the bank or wallet the buyer picked (payFrom).
  const cashAccount = input.payFrom || ACCOUNT.cash;
  if (paid > 0) await requirePaymentAccount(ctx, cashAccount);

  // 3. Stock in, one batch per line, and price maintenance.
  const purchaseId = db.newId();
  const items = [];
  for (const line of lines) {
    const batch = await addBatchIn(ctx, {
      productId: line.productId,
      batchNo: line.batchNo,
      expiry: line.expiry,
      costPerPack: line.costPerPack,
      mrp: line.mrp,
      units: line.units,
      date,
      type: 'purchase',
      docType: 'purchase',
      docId: purchaseId,
    });

    // Read again: an earlier line may have changed the same product in this transaction.
    const product = await ctx.get('products', line.productId);
    const patch = {};
    if (settings.updateCostFromLastPurchase) patch.costPerPack = line.costPerPack;
    if (line.mrp > 0 && line.mrp !== product.mrpPerPack) patch.mrpPerPack = line.mrp;
    if (settings.updateSalePriceOnMrpChange && line.mrp > 0 && line.mrp !== product.salePricePerPack) {
      patch.salePricePerPack = line.mrp;
    }
    if (Object.keys(patch).length) ctx.put('products', { ...product, ...patch });

    items.push({
      id: db.newId(),
      purchaseId,
      productId: line.productId,
      productName: line.productName,
      batchId: batch.id,
      batchNo: line.batchNo,
      expiry: line.expiry,
      packs: line.packs,
      units: line.units,
      costPerPack: line.costPerPack,
      mrp: line.mrp,
      amount: line.amount,
      returnedPacks: 0,
    });
  }

  // 4. Document, lines and ledger.
  const number = await nextDocNumber(ctx, 'purchase');
  const purchase = ctx.put('purchases', {
    id: purchaseId,
    number,
    date,
    supplierId,
    total,
    paid,
    balance,
    note: String(input.note ?? '').trim(),
    returnedValue: 0,
    payFrom: cashAccount,
  });
  for (const item of items) ctx.put('purchaseItems', item);

  const entryId = await postEntryIn(ctx, {
    date,
    docType: 'purchase',
    docId: purchaseId,
    memo: number,
    lines: purchaseLines({ total, paid, balance, supplierId, cashAccount }),
  });
  return { ...purchase, items, entryId };
}

export function createPurchase(input) {
  return db.transaction((ctx) => createPurchaseIn(ctx, input));
}

export async function getPurchaseWithItems(id) {
  const purchase = await db.get('purchases', id);
  if (!purchase) throw missing('purchase', id);
  const items = await db.getAll('purchaseItems', { index: 'purchaseId', query: id });
  return { ...purchase, items };
}

export async function listPurchases({ from = '', to = '￿' } = {}) {
  const rows = await db.getAll('purchases', { index: 'date', query: IDBKeyRange.bound(from, to) });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
